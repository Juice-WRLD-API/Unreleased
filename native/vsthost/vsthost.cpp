// Unreleased's native Session Maker engine and VST3 host. Electron runs this
// beside the renderer; Windows playback uses the persistent 'session' mode.
//
//   vsthost list                 JSON array of the .vst3 modules in the standard folders
//   vsthost scan <module>        JSON { ok, name, classes: [{ cid, name, vendor, version, sub }] }
//   vsthost process              stdin:  one JSON line { sampleRate, channels, frames, bpm, chain: [{ path, cid, state }] }
//                                        then channels * frames planar float32
//                                stdout: one JSON line { ok, channels, frames } then the same layout,
//                                        or { ok: false, error, plugin }
//   vsthost edit [--owner HWND]  stdin:  one JSON line { path, cid, state, title, sampleRate }, then "focus" / "close" lines
//                                stdout: JSON lines { type: "open" | "state" | "closed" | "error", ... }
//   vsthost session             persistent commands/assets, WASAPI output, JSON acknowledgements/position
//   vsthost session-render      same native mixer, offline planar float32 output (no audio device)
//
// State is a host-side blob - the component's and controller's own state - base64'd so it
// can live in the project JSON. Each mode is its own process, so a plug-in that crashes
// takes only that job with it.

#include "pluginterfaces/base/funknown.h"
#include "pluginterfaces/base/funknownimpl.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/gui/iplugviewcontentscalesupport.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstmessage.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/vsttypes.h"
#include "public.sdk/source/common/memorystream.h"
#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/hosting/processdata.h"
#include "public.sdk/source/vst/utility/stringconvert.h"

#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <ole2.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <mmreg.h>
#include <stdexcept>
#include <array>
#include <condition_variable>
#include <deque>
#include <avrt.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace {

// ─── Protocol output ────────────────────────────────────────────────────────
// Plug-ins print to stdout now and then; the real stdout is kept for us and fd 1 is
// pointed at stderr, so nothing they write can land in the middle of our stream.

FILE* gOut = nullptr;
std::mutex gOutLock;

void claimStdout ()
{
	_setmode (_fileno (stdin), _O_BINARY);
	_setmode (_fileno (stdout), _O_BINARY);
	int fd = _dup (_fileno (stdout));
	gOut = _fdopen (fd, "wb");
	_dup2 (_fileno (stderr), _fileno (stdout));
	SetStdHandle (STD_OUTPUT_HANDLE, GetStdHandle (STD_ERROR_HANDLE));
}

void sendLine (const std::string& s)
{
	std::lock_guard<std::mutex> l (gOutLock);
	fwrite (s.data (), 1, s.size (), gOut);
	fputc ('\n', gOut);
	fflush (gOut);
}

std::string jsonStr (const std::string& s)
{
	std::string o = "\"";
	for (unsigned char c : s)
	{
		switch (c)
		{
			case '"': o += "\\\""; break;
			case '\\': o += "\\\\"; break;
			case '\n': o += "\\n"; break;
			case '\r': o += "\\r"; break;
			case '\t': o += "\\t"; break;
			default:
				if (c < 0x20)
				{
					char b[8];
					snprintf (b, sizeof b, "\\u%04x", c);
					o += b;
				}
				else
					o += static_cast<char> (c);
		}
	}
	return o + "\"";
}

// ─── A small JSON reader - just what the headers need ───────────────────────

struct Json
{
	enum Kind { Null, Bool, Num, Str, Arr, Obj } kind {Null};
	bool b {false};
	double n {0};
	std::string s;
	std::vector<Json> a;
	std::vector<std::pair<std::string, Json>> o;

	const Json& operator[] (const char* key) const
	{
		static const Json none;
		for (auto& kv : o)
			if (kv.first == key)
				return kv.second;
		return none;
	}
	double num (double fallback = 0) const { return kind == Num ? n : fallback; }
	std::string str () const { return kind == Str ? s : std::string (); }
};

struct JsonReader
{
	const char* p;
	const char* end;

	void ws ()
	{
		while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r'))
			p++;
	}
	static void utf8 (std::string& out, uint32_t cp)
	{
		if (cp < 0x80)
			out += static_cast<char> (cp);
		else if (cp < 0x800)
		{
			out += static_cast<char> (0xC0 | (cp >> 6));
			out += static_cast<char> (0x80 | (cp & 0x3F));
		}
		else if (cp < 0x10000)
		{
			out += static_cast<char> (0xE0 | (cp >> 12));
			out += static_cast<char> (0x80 | ((cp >> 6) & 0x3F));
			out += static_cast<char> (0x80 | (cp & 0x3F));
		}
		else
		{
			out += static_cast<char> (0xF0 | (cp >> 18));
			out += static_cast<char> (0x80 | ((cp >> 12) & 0x3F));
			out += static_cast<char> (0x80 | ((cp >> 6) & 0x3F));
			out += static_cast<char> (0x80 | (cp & 0x3F));
		}
	}
	uint32_t hex4 ()
	{
		uint32_t v = 0;
		for (int i = 0; i < 4 && p < end; i++, p++)
		{
			char c = *p;
			v = v * 16 + (c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : 0);
		}
		return v;
	}
	bool string (std::string& out)
	{
		if (p >= end || *p != '"')
			return false;
		p++;
		while (p < end && *p != '"')
		{
			char c = *p++;
			if (c != '\\')
			{
				out += c;
				continue;
			}
			if (p >= end)
				return false;
			char e = *p++;
			switch (e)
			{
				case 'n': out += '\n'; break;
				case 't': out += '\t'; break;
				case 'r': out += '\r'; break;
				case 'b': out += '\b'; break;
				case 'f': out += '\f'; break;
				case 'u':
				{
					uint32_t cp = hex4 ();
					if (cp >= 0xD800 && cp < 0xDC00 && p + 1 < end && p[0] == '\\' && p[1] == 'u')
					{
						p += 2;
						uint32_t lo = hex4 ();
						cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
					}
					utf8 (out, cp);
					break;
				}
				default: out += e;
			}
		}
		if (p >= end)
			return false;
		p++;
		return true;
	}
	bool value (Json& v)
	{
		ws ();
		if (p >= end)
			return false;
		if (*p == '{')
		{
			v.kind = Json::Obj;
			p++;
			ws ();
			if (p < end && *p == '}')
			{
				p++;
				return true;
			}
			for (;;)
			{
				ws ();
				std::string key;
				if (!string (key))
					return false;
				ws ();
				if (p >= end || *p != ':')
					return false;
				p++;
				Json child;
				if (!value (child))
					return false;
				v.o.emplace_back (std::move (key), std::move (child));
				ws ();
				if (p < end && *p == ',')
				{
					p++;
					continue;
				}
				if (p < end && *p == '}')
				{
					p++;
					return true;
				}
				return false;
			}
		}
		if (*p == '[')
		{
			v.kind = Json::Arr;
			p++;
			ws ();
			if (p < end && *p == ']')
			{
				p++;
				return true;
			}
			for (;;)
			{
				Json child;
				if (!value (child))
					return false;
				v.a.push_back (std::move (child));
				ws ();
				if (p < end && *p == ',')
				{
					p++;
					continue;
				}
				if (p < end && *p == ']')
				{
					p++;
					return true;
				}
				return false;
			}
		}
		if (*p == '"')
		{
			v.kind = Json::Str;
			return string (v.s);
		}
		if (end - p >= 4 && !strncmp (p, "true", 4))
		{
			v.kind = Json::Bool;
			v.b = true;
			p += 4;
			return true;
		}
		if (end - p >= 5 && !strncmp (p, "false", 5))
		{
			v.kind = Json::Bool;
			p += 5;
			return true;
		}
		if (end - p >= 4 && !strncmp (p, "null", 4))
		{
			p += 4;
			return true;
		}
		char* stop = nullptr;
		std::string num;
		while (p < end && strchr ("+-0123456789.eE", *p))
			num += *p++;
		if (num.empty ())
			return false;
		v.kind = Json::Num;
		v.n = strtod (num.c_str (), &stop);
		return true;
	}
};

bool parseJson (const std::string& text, Json& out)
{
	JsonReader r {text.data (), text.data () + text.size ()};
	return r.value (out);
}

bool readLine (std::string& line)
{
	line.clear ();
	int c;
	while ((c = fgetc (stdin)) != EOF)
	{
		if (c == '\n')
			return true;
		if (c != '\r')
			line += static_cast<char> (c);
	}
	return !line.empty ();
}

// ─── Base64 ─────────────────────────────────────────────────────────────────

const char* kB64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string b64encode (const std::vector<uint8_t>& in)
{
	std::string out;
	out.reserve ((in.size () + 2) / 3 * 4);
	size_t i = 0;
	for (; i + 2 < in.size (); i += 3)
	{
		uint32_t v = (in[i] << 16) | (in[i + 1] << 8) | in[i + 2];
		out += kB64[v >> 18];
		out += kB64[(v >> 12) & 63];
		out += kB64[(v >> 6) & 63];
		out += kB64[v & 63];
	}
	if (i < in.size ())
	{
		uint32_t v = in[i] << 16;
		if (i + 1 < in.size ())
			v |= in[i + 1] << 8;
		out += kB64[v >> 18];
		out += kB64[(v >> 12) & 63];
		out += i + 1 < in.size () ? kB64[(v >> 6) & 63] : '=';
		out += '=';
	}
	return out;
}

std::vector<uint8_t> b64decode (const std::string& in)
{
	int map[256];
	std::fill (map, map + 256, -1);
	for (int i = 0; i < 64; i++)
		map[static_cast<unsigned char> (kB64[i])] = i;
	std::vector<uint8_t> out;
	out.reserve (in.size () / 4 * 3);
	uint32_t acc = 0;
	int bits = 0;
	for (unsigned char c : in)
	{
		if (map[c] < 0)
			continue;
		acc = (acc << 6) | map[c];
		bits += 6;
		if (bits >= 8)
		{
			bits -= 8;
			out.push_back (static_cast<uint8_t> ((acc >> bits) & 0xFF));
		}
	}
	return out;
}

// ─── Host ───────────────────────────────────────────────────────────────────

class Host : public HostApplication
{
public:
	tresult PLUGIN_API getName (String128 name) override
	{
		return StringConvert::convert ("Unreleased", name) ? kResultTrue : kInternalError;
	}
};

Host& host ()
{
	static Host* h = new Host; // Lives as long as the process; plug-ins may hold it.
	return *h;
}

std::map<std::string, VST3::Hosting::Module::Ptr>& modules ()
{
	static std::map<std::string, VST3::Hosting::Module::Ptr> m;
	return m;
}

VST3::Hosting::Module::Ptr loadModule (const std::string& path, std::string& error)
{
	auto& m = modules ();
	auto it = m.find (path);
	if (it != m.end ())
		return it->second;
	auto mod = VST3::Hosting::Module::create (path, error);
	if (mod)
	{
		mod->getFactory ().setHostContext (&host ());
		m[path] = mod;
	}
	return mod;
}

std::vector<uint8_t> streamBytes (MemoryStream& s)
{
	auto* d = reinterpret_cast<uint8_t*> (s.getData ());
	return std::vector<uint8_t> (d, d + s.getSize ());
}

/** One plug-in instance: its processor half and, when it has one, its controller half. */
struct Plug
{
	VST3::Hosting::Module::Ptr module;
	IPtr<IComponent> component;
	IPtr<IEditController> controller;
	IPtr<IAudioProcessor> processor;
	IPtr<Steinberg::Vst::IConnectionPoint> compCP, ctrlCP;
	bool single {false};
	bool active {false};
	bool processing {false};
	std::string name;

	~Plug () { unload (); }

	bool load (const std::string& path, const std::string& cid, std::string& error)
	{
		module = loadModule (path, error);
		if (!module)
			return false;
		auto& factory = module->getFactory ();
		auto uid = VST3::UID::fromString (cid);
		for (auto& info : factory.classInfos ())
		{
			if (info.category () != kVstAudioEffectClass)
				continue;
			if (uid && *uid != info.ID ())
				continue;
			name = info.name ();
			component = factory.createInstance<IComponent> (info.ID ());
			break;
		}
		if (!component)
		{
			error = "The plug-in couldn't be created";
			return false;
		}
		if (component->initialize (&host ()) != kResultOk)
		{
			component = nullptr;
			error = "The plug-in didn't start";
			return false;
		}
		processor = U::cast<IAudioProcessor> (component);
		if (!processor)
		{
			error = "Not an audio effect";
			return false;
		}
		if (auto c = U::cast<IEditController> (component))
		{
			controller = c;
			single = true;
		}
		else
		{
			TUID ctrlCid;
			if (component->getControllerClassId (ctrlCid) == kResultTrue)
			{
				controller = factory.createInstance<IEditController> (VST3::UID (ctrlCid));
				if (controller && controller->initialize (&host ()) != kResultOk)
					controller = nullptr;
			}
			if (controller)
			{
				compCP = U::cast<Steinberg::Vst::IConnectionPoint> (component);
				ctrlCP = U::cast<Steinberg::Vst::IConnectionPoint> (controller);
				if (compCP && ctrlCP)
				{
					compCP->connect (ctrlCP);
					ctrlCP->connect (compCP);
				}
			}
		}
		syncController ();
		return true;
	}

	/** Hands the controller the component's state, as a host does after loading. */
	void syncController ()
	{
		if (!controller || single)
			return;
		MemoryStream s;
		if (component->getState (&s) == kResultTrue)
		{
			s.seek (0, IBStream::kIBSeekSet, nullptr);
			controller->setComponentState (&s);
		}
	}

	bool setState (const std::string& b64)
	{
		auto bytes = b64decode (b64);
		if (bytes.size () < 12 || memcmp (bytes.data (), "UVS1", 4))
			return false;
		uint32_t compLen = 0, ctrlLen = 0;
		memcpy (&compLen, bytes.data () + 4, 4);
		if (8 + compLen + 4 > bytes.size ())
			return false;
		memcpy (&ctrlLen, bytes.data () + 8 + compLen, 4);
		if (8 + compLen + 4 + ctrlLen > bytes.size ())
			return false;
		uint8_t* comp = bytes.data () + 8;
		uint8_t* ctrl = bytes.data () + 12 + compLen;
		{
			MemoryStream s (comp, compLen);
			component->setState (&s);
		}
		if (controller)
		{
			if (!single)
			{
				MemoryStream s (comp, compLen);
				controller->setComponentState (&s);
			}
			if (ctrlLen)
			{
				MemoryStream s (ctrl, ctrlLen);
				controller->setState (&s);
			}
		}
		return true;
	}

	std::string getState ()
	{
		MemoryStream comp, ctrl;
		component->getState (&comp);
		if (controller && !single)
			controller->getState (&ctrl);
		auto c = streamBytes (comp), k = streamBytes (ctrl);
		std::vector<uint8_t> out (12 + c.size () + k.size ());
		uint32_t cl = static_cast<uint32_t> (c.size ()), kl = static_cast<uint32_t> (k.size ());
		memcpy (out.data (), "UVS1", 4);
		memcpy (out.data () + 4, &cl, 4);
		if (cl)
			memcpy (out.data () + 8, c.data (), cl);
		memcpy (out.data () + 8 + cl, &kl, 4);
		if (kl)
			memcpy (out.data () + 12 + cl, k.data (), kl);
		return b64encode (out);
	}

	/** Stereo in and out where the plug-in allows it, its main buses on and any side-chains off. */
	bool start (double sampleRate, int32 block, int32 mode, std::string& error)
	{
		int32 nIn = component->getBusCount (kAudio, kInput);
		int32 nOut = component->getBusCount (kAudio, kOutput);
		if (nOut < 1)
		{
			error = "The plug-in has no audio output";
			return false;
		}
		std::vector<SpeakerArrangement> ins (nIn), outs (nOut);
		for (int32 i = 0; i < nIn; i++)
			processor->getBusArrangement (kInput, i, ins[i]);
		for (int32 i = 0; i < nOut; i++)
			processor->getBusArrangement (kOutput, i, outs[i]);
		auto want = ins, wantOut = outs;
		if (nIn)
			want[0] = SpeakerArr::kStereo;
		wantOut[0] = SpeakerArr::kStereo;
		if (processor->setBusArrangements (want.data (), nIn, wantOut.data (), nOut) != kResultTrue)
		{
			// Mono in, stereo out - then whatever it already has.
			if (nIn)
				want[0] = SpeakerArr::kMono;
			if (processor->setBusArrangements (want.data (), nIn, wantOut.data (), nOut) != kResultTrue)
				processor->setBusArrangements (ins.data (), nIn, outs.data (), nOut);
		}
		for (int32 i = 0; i < nIn; i++)
			component->activateBus (kAudio, kInput, i, i == 0);
		for (int32 i = 0; i < nOut; i++)
			component->activateBus (kAudio, kOutput, i, i == 0);
		component->activateBus (kEvent, kInput, 0, false);

		if (processor->canProcessSampleSize (kSample32) != kResultTrue)
		{
			error = "The plug-in only works in 64-bit floats";
			return false;
		}
		ProcessSetup setup {mode, kSample32, block, sampleRate};
		if (processor->setupProcessing (setup) != kResultOk)
		{
			setup.processMode = kRealtime;
			if (processor->setupProcessing (setup) != kResultOk)
			{
				error = "The plug-in won't run at this sample rate";
				return false;
			}
		}
		if (component->setActive (true) != kResultOk)
		{
			error = "The plug-in wouldn't switch on";
			return false;
		}
		active = true;
		processor->setProcessing (true);
		processing = true;
		return true;
	}

	void stop ()
	{
		if (processing)
			processor->setProcessing (false);
		processing = false;
		if (active)
			component->setActive (false);
		active = false;
	}

	void unload ()
	{
		stop ();
		if (compCP && ctrlCP)
		{
			compCP->disconnect (ctrlCP);
			ctrlCP->disconnect (compCP);
		}
		compCP = nullptr;
		ctrlCP = nullptr;
		if (controller && !single)
			controller->terminate ();
		controller = nullptr;
		processor = nullptr;
		if (component)
			component->terminate ();
		component = nullptr;
	}
};

// ─── list / scan ────────────────────────────────────────────────────────────

int runList ()
{
	std::string out = "[";
	bool first = true;
	for (auto& p : VST3::Hosting::Module::getModulePaths ())
	{
		out += (first ? "" : ",") + jsonStr (p);
		first = false;
	}
	sendLine (out + "]");
	return 0;
}

int runScan (const std::string& path)
{
	std::string error;
	auto mod = VST3::Hosting::Module::create (path, error);
	if (!mod)
	{
		sendLine ("{\"ok\":false,\"error\":" + jsonStr (error.empty () ? "Couldn't load the module" : error) + "}");
		return 1;
	}
	std::string out = "{\"ok\":true,\"name\":" + jsonStr (mod->getName ()) + ",\"classes\":[";
	bool first = true;
	for (auto& info : mod->getFactory ().classInfos ())
	{
		if (info.category () != kVstAudioEffectClass)
			continue;
		out += first ? "" : ",";
		first = false;
		out += "{\"cid\":" + jsonStr (info.ID ().toString ()) + ",\"name\":" + jsonStr (info.name ()) +
		       ",\"vendor\":" + jsonStr (info.vendor ()) + ",\"version\":" + jsonStr (info.version ()) +
		       ",\"sub\":" + jsonStr (info.subCategoriesString ()) + "}";
	}
	sendLine (out + "]}");
	return 0;
}

// ─── process ────────────────────────────────────────────────────────────────

constexpr int32 kBlock = 512;

void fillContext (ProcessContext& ctx, double sampleRate, double bpm, int64 pos)
{
	ctx = {};
	ctx.state = ProcessContext::kPlaying | ProcessContext::kTempoValid | ProcessContext::kTimeSigValid |
	            ProcessContext::kProjectTimeMusicValid;
	ctx.sampleRate = sampleRate;
	ctx.projectTimeSamples = pos;
	ctx.tempo = bpm;
	ctx.timeSigNumerator = 4;
	ctx.timeSigDenominator = 4;
	ctx.projectTimeMusic = (static_cast<double> (pos) / sampleRate) * (bpm / 60.0);
}

/** Runs the audio through one plug-in, in place. The plug-in's own latency is fed past and
 *  trimmed off, so what comes out lines up with what went in. */
bool processThrough (Plug& plug, std::vector<std::vector<float>>& chans, int64 frames, double sampleRate,
                     double bpm, std::string& error)
{
	if (!plug.start (sampleRate, kBlock, kOffline, error))
		return false;
	HostProcessData data;
	data.prepare (*plug.component, kBlock, kSample32);
	if (data.numOutputs < 1 || data.outputs[0].numChannels < 1)
	{
		error = "The plug-in has no audio output";
		return false;
	}
	int32 inCh = data.numInputs > 0 ? data.inputs[0].numChannels : 0;
	int32 outCh = std::min<int32> (2, data.outputs[0].numChannels);
	int64 latency = std::max<int64> (0, plug.processor->getLatencySamples ());
	int32 srcCh = static_cast<int32> (chans.size ());

	std::vector<std::vector<float>> out (outCh, std::vector<float> (static_cast<size_t> (frames), 0.f));
	ParameterChanges inParams, outParams;
	EventList inEvents, outEvents;
	ProcessContext ctx {};
	data.inputParameterChanges = &inParams;
	data.outputParameterChanges = &outParams;
	data.inputEvents = &inEvents;
	data.outputEvents = &outEvents;
	data.processContext = &ctx;
	data.processMode = kOffline;

	int64 total = frames + latency;
	for (int64 pos = 0; pos < total; pos += kBlock)
	{
		int32 n = static_cast<int32> (std::min<int64> (kBlock, total - pos));
		for (int32 b = 0; b < data.numInputs; b++)
		{
			auto& bus = data.inputs[b];
			bus.silenceFlags = 0;
			for (int32 c = 0; c < bus.numChannels; c++)
			{
				float* dst = bus.channelBuffers32[c];
				for (int32 i = 0; i < n; i++)
				{
					int64 at = pos + i;
					float v = 0.f;
					if (b == 0 && at < frames)
					{
						if (inCh == 1 && srcCh > 1)
							v = 0.5f * (chans[0][at] + chans[1][at]);
						else
							v = chans[std::min (c, srcCh - 1)][at];
					}
					dst[i] = v;
				}
			}
		}
		for (int32 b = 0; b < data.numOutputs; b++)
			for (int32 c = 0; c < data.outputs[b].numChannels; c++)
				memset (data.outputs[b].channelBuffers32[c], 0, sizeof (float) * kBlock);
		data.numSamples = n;
		fillContext (ctx, sampleRate, bpm, pos);
		inParams.clearQueue ();
		outParams.clearQueue ();
		inEvents.clear ();
		outEvents.clear ();
		if (plug.processor->process (data) != kResultOk)
		{
			error = "The plug-in stopped processing";
			return false;
		}
		for (int32 c = 0; c < outCh; c++)
		{
			const float* src = data.outputs[0].channelBuffers32[c];
			for (int32 i = 0; i < n; i++)
			{
				int64 at = pos + i - latency;
				if (at >= 0 && at < frames)
					out[c][at] = src[i];
			}
		}
	}
	// A mono plug-in still gives stereo back if stereo went in.
	if (outCh == 1 && srcCh > 1)
		out.push_back (out[0]);
	chans = std::move (out);
	plug.stop ();
	return true;
}

bool readExact (void* dst, size_t bytes)
{
	auto* p = static_cast<uint8_t*> (dst);
	while (bytes)
	{
		size_t got = fread (p, 1, bytes, stdin);
		if (!got)
			return false;
		p += got;
		bytes -= got;
	}
	return true;
}

int runProcess ()
{
	std::string line;
	Json head;
	if (!readLine (line) || !parseJson (line, head))
	{
		sendLine ("{\"ok\":false,\"error\":\"Bad request\"}");
		return 1;
	}
	double sampleRate = head["sampleRate"].num (48000);
	int32 channels = static_cast<int32> (head["channels"].num (2));
	int64 frames = static_cast<int64> (head["frames"].num (0));
	double bpm = head["bpm"].num (120);
	if (bpm <= 0)
		bpm = 120;
	if (channels < 1 || channels > 2 || frames < 0)
	{
		sendLine ("{\"ok\":false,\"error\":\"Bad request\"}");
		return 1;
	}
	std::vector<std::vector<float>> chans (channels, std::vector<float> (static_cast<size_t> (frames)));
	for (auto& c : chans)
		if (frames && !readExact (c.data (), sizeof (float) * static_cast<size_t> (frames)))
		{
			sendLine ("{\"ok\":false,\"error\":\"Audio cut short\"}");
			return 1;
		}

	auto& chain = head["chain"].a;
	for (size_t i = 0; i < chain.size (); i++)
	{
		std::string error;
		auto plug = std::make_unique<Plug> ();
		bool ok = plug->load (chain[i]["path"].str (), chain[i]["cid"].str (), error);
		if (ok && !chain[i]["state"].str ().empty ())
			plug->setState (chain[i]["state"].str ());
		if (ok)
			ok = processThrough (*plug, chans, frames, sampleRate, bpm, error);
		if (!ok)
		{
			sendLine ("{\"ok\":false,\"plugin\":" + std::to_string (i) + ",\"error\":" + jsonStr (error) + "}");
			return 1;
		}
	}
	sendLine ("{\"ok\":true,\"channels\":" + std::to_string (chans.size ()) + ",\"frames\":" +
	          std::to_string (frames) + "}");
	{
		std::lock_guard<std::mutex> l (gOutLock);
		for (auto& c : chans)
			fwrite (c.data (), sizeof (float), c.size (), gOut);
		fflush (gOut);
	}
	return 0;
}

// ─── edit ───────────────────────────────────────────────────────────────────
// The plug-in's own window. Its controller's edits go to the processor (through a short
// silent process call, as a running host would deliver them), and the state goes back up
// to the app whenever it changes.

constexpr UINT WM_HOST_FOCUS = WM_APP + 1;
constexpr UINT_PTR kFlushTimer = 1;
constexpr UINT_PTR kPollTimer = 2;

struct Editor;
Editor* gEditor = nullptr;

struct Editor : IComponentHandler, IPlugFrame
{
	Plug plug;
	IPtr<IPlugView> view;
	HWND hwnd {nullptr};
	HostProcessData data;
	ParameterChanges pending, outParams;
	EventList inEvents, outEvents;
	ProcessContext ctx {};
	double sampleRate {48000};
	bool processReady {false};
	bool dirty {false};
	bool parameterEdits {false};
	bool stateInvalidated {false};
	DWORD lastEdit {0};
	std::string lastState;
	bool resizing {false};

	// The handler and frame live as long as the editor; plug-ins' ref counting doesn't own them.
	tresult PLUGIN_API queryInterface (const TUID iid, void** obj) override
	{
		if (FUnknownPrivate::iidEqual (iid, IComponentHandler::iid))
		{
			*obj = static_cast<IComponentHandler*> (this);
			return kResultTrue;
		}
		if (FUnknownPrivate::iidEqual (iid, IPlugFrame::iid))
		{
			*obj = static_cast<IPlugFrame*> (this);
			return kResultTrue;
		}
		if (FUnknownPrivate::iidEqual (iid, FUnknown::iid))
		{
			*obj = static_cast<IComponentHandler*> (this);
			return kResultTrue;
		}
		*obj = nullptr;
		return kNoInterface;
	}
	uint32 PLUGIN_API addRef () override { return 1000; }
	uint32 PLUGIN_API release () override { return 1000; }

	tresult PLUGIN_API beginEdit (ParamID) override { return kResultOk; }
	tresult PLUGIN_API performEdit (ParamID id, ParamValue value) override
	{
		parameterEdits = true;
		int32 qi = 0, pi = 0;
		if (auto* q = pending.addParameterData (id, qi))
			q->addPoint (0, value, pi);
		sendLine ("{\"type\":\"parameter\",\"param\":" + std::to_string (id) + ",\"value\":" + std::to_string (value) + "}");
		touched ();
		return kResultOk;
	}
	tresult PLUGIN_API endEdit (ParamID) override
	{
		touched ();
		return kResultOk;
	}
	tresult PLUGIN_API restartComponent (int32 flags) override
	{
		// Presets and structural changes still require a full state transfer.
		if (flags & (kReloadComponent | kIoChanged | kParamValuesChanged | kLatencyChanged))
			stateInvalidated = true;
		if (flags & kLatencyChanged && processReady)
		{
			plug.stop ();
			std::string error;
			processReady = plug.start (sampleRate, 64, kRealtime, error);
		}
		touched ();
		return kResultOk;
	}
	void touched ()
	{
		dirty = true;
		lastEdit = GetTickCount ();
	}

	tresult PLUGIN_API resizeView (IPlugView* v, ViewRect* r) override
	{
		if (!r || !v || !hwnd || resizing)
			return kInvalidArgument;
		resizing = true;
		RECT rc {0, 0, r->getWidth (), r->getHeight ()};
		AdjustWindowRectEx (&rc, GetWindowLong (hwnd, GWL_STYLE), FALSE, GetWindowLong (hwnd, GWL_EXSTYLE));
		SetWindowPos (hwnd, nullptr, 0, 0, rc.right - rc.left, rc.bottom - rc.top,
		              SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
		RECT client;
		GetClientRect (hwnd, &client);
		ViewRect now {};
		if (v->getSize (&now) == kResultTrue &&
		    (now.getWidth () != client.right || now.getHeight () != client.bottom))
		{
			ViewRect fit {0, 0, client.right, client.bottom};
			v->onSize (&fit);
		}
		resizing = false;
		return kResultTrue;
	}

	/** Delivers queued parameter edits to the processor. */
	void flush ()
	{
		if (!processReady || pending.getParameterCount () == 0)
			return;
		for (int32 b = 0; b < data.numInputs; b++)
			for (int32 c = 0; c < data.inputs[b].numChannels; c++)
				memset (data.inputs[b].channelBuffers32[c], 0, sizeof (float) * 64);
		data.numSamples = 32;
		data.inputParameterChanges = &pending;
		data.outputParameterChanges = &outParams;
		data.inputEvents = &inEvents;
		data.outputEvents = &outEvents;
		ctx = {};
		ctx.sampleRate = sampleRate;
		ctx.tempo = 120;
		ctx.state = ProcessContext::kTempoValid;
		data.processContext = &ctx;
		plug.processor->process (data);
		pending.clearQueue ();
		outParams.clearQueue ();
		outEvents.clear ();
	}

	void sendState (bool force)
	{
		auto s = plug.getState ();
		bool parametersOnly = parameterEdits && !stateInvalidated;
		parameterEdits = stateInvalidated = false;
		if (!force && s == lastState)
			return;
		lastState = s;
		sendLine ("{\"type\":\"state\",\"parametersOnly\":" + std::string (parametersOnly ? "true" : "false") + ",\"state\":" + jsonStr (s) + "}");
	}

	void onTimer (UINT_PTR id)
	{
		if (id == kFlushTimer)
		{
			flush ();
			if (dirty && GetTickCount () - lastEdit > 250)
			{
				dirty = false;
				sendState (false);
			}
		}
		else if (id == kPollTimer && !dirty)
			sendState (false); // Changes that never went through performEdit, like a preset load.
	}

	void close ()
	{
		if (!hwnd)
			return;
		KillTimer (hwnd, kFlushTimer);
		KillTimer (hwnd, kPollTimer);
		flush ();
		sendState (false);
		if (view)
		{
			view->setFrame (nullptr);
			view->removed ();
			view = nullptr;
		}
		DestroyWindow (hwnd);
		hwnd = nullptr;
	}
};

float dpiScale (HWND hwnd)
{
	using GetDpiForWindowFn = UINT (WINAPI*) (HWND);
	static auto fn = reinterpret_cast<GetDpiForWindowFn> (
	    GetProcAddress (GetModuleHandleW (L"user32.dll"), "GetDpiForWindow"));
	return fn && hwnd ? fn (hwnd) / 96.f : 1.f;
}

LRESULT CALLBACK editorProc (HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
	auto* ed = gEditor;
	switch (msg)
	{
		case WM_ERASEBKGND: return TRUE;
		case WM_TIMER:
			if (ed)
				ed->onTimer (wp);
			return 0;
		case WM_SIZE:
			if (ed && ed->view && !ed->resizing)
			{
				ViewRect r {0, 0, LOWORD (lp), HIWORD (lp)};
				ViewRect now {};
				if (ed->view->getSize (&now) == kResultTrue &&
				    (now.getWidth () != r.right || now.getHeight () != r.bottom))
					ed->view->onSize (&r);
			}
			break;
		case WM_SIZING:
			if (ed && ed->view)
			{
				auto* rc = reinterpret_cast<RECT*> (lp);
				RECT frame {0, 0, 0, 0};
				AdjustWindowRectEx (&frame, GetWindowLong (hwnd, GWL_STYLE), FALSE, GetWindowLong (hwnd, GWL_EXSTYLE));
				ViewRect want {0, 0, (rc->right - rc->left) - (frame.right - frame.left),
				               (rc->bottom - rc->top) - (frame.bottom - frame.top)};
				if (ed->view->checkSizeConstraint (&want) == kResultTrue)
				{
					rc->right = rc->left + want.getWidth () + (frame.right - frame.left);
					rc->bottom = rc->top + want.getHeight () + (frame.bottom - frame.top);
				}
				return TRUE;
			}
			break;
		case WM_DPICHANGED:
			if (ed && ed->view)
			{
				if (auto css = U::cast<IPlugViewContentScaleSupport> (ed->view))
					css->setContentScaleFactor (HIWORD (wp) / 96.f);
				auto* rc = reinterpret_cast<RECT*> (lp);
				SetWindowPos (hwnd, nullptr, rc->left, rc->top, rc->right - rc->left, rc->bottom - rc->top,
				              SWP_NOZORDER | SWP_NOACTIVATE);
			}
			return 0;
		case WM_HOST_FOCUS:
			if (IsIconic (hwnd))
				ShowWindow (hwnd, SW_RESTORE);
			SetForegroundWindow (hwnd);
			return 0;
		case WM_CLOSE:
			if (ed)
				ed->close ();
			PostQuitMessage (0);
			return 0;
	}
	return DefWindowProcW (hwnd, msg, wp, lp);
}

int runEdit (HWND owner)
{
	std::string line;
	Json head;
	if (!readLine (line) || !parseJson (line, head))
	{
		sendLine ("{\"type\":\"error\",\"error\":\"Bad request\"}");
		return 1;
	}
	auto ed = std::make_unique<Editor> ();
	gEditor = ed.get ();
	ed->sampleRate = head["sampleRate"].num (48000);
	std::string error;
	if (!ed->plug.load (head["path"].str (), head["cid"].str (), error))
	{
		sendLine ("{\"type\":\"error\",\"error\":" + jsonStr (error) + "}");
		return 1;
	}
	if (!head["state"].str ().empty ())
		ed->plug.setState (head["state"].str ());
	if (!ed->plug.controller)
	{
		sendLine ("{\"type\":\"error\",\"error\":\"This plug-in has no controls to show\"}");
		return 1;
	}
	ed->plug.controller->setComponentHandler (ed.get ());
	ed->processReady = ed->plug.start (ed->sampleRate, 64, kRealtime, error);
	if (ed->processReady)
		ed->data.prepare (*ed->plug.component, 64, kSample32);
	ed->lastState = ed->plug.getState ();

	ed->view = owned (ed->plug.controller->createView (ViewType::kEditor));
	if (!ed->view || ed->view->isPlatformTypeSupported (kPlatformTypeHWND) != kResultTrue)
	{
		sendLine ("{\"type\":\"error\",\"error\":\"This plug-in has no window of its own\"}");
		return 1;
	}

	HINSTANCE inst = GetModuleHandleW (nullptr);
	WNDCLASSEXW wc {sizeof (WNDCLASSEXW)};
	wc.style = CS_DBLCLKS;
	wc.lpfnWndProc = editorProc;
	wc.hInstance = inst;
	wc.hCursor = LoadCursor (nullptr, IDC_ARROW);
	wc.hIcon = LoadIcon (inst, MAKEINTRESOURCE (1));
	wc.lpszClassName = L"UnreleasedPluginWindow";
	RegisterClassExW (&wc);

	ViewRect size {};
	if (ed->view->getSize (&size) != kResultTrue || size.getWidth () <= 0)
		size = {0, 0, 640, 400};
	DWORD style = WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
	if (ed->view->canResize () == kResultTrue)
		style |= WS_SIZEBOX | WS_MAXIMIZEBOX;
	RECT rc {0, 0, size.getWidth (), size.getHeight ()};
	AdjustWindowRectEx (&rc, style, FALSE, 0);
	std::string title = head["title"].str ();
	if (title.empty ())
		title = ed->plug.name;
	auto wtitle = StringConvert::convert (title);
	ed->hwnd = CreateWindowExW (0, wc.lpszClassName, reinterpret_cast<const wchar_t*> (wtitle.c_str ()), style,
	                            CW_USEDEFAULT, CW_USEDEFAULT, rc.right - rc.left, rc.bottom - rc.top, nullptr,
	                            nullptr, inst, nullptr);
	if (!ed->hwnd)
	{
		sendLine ("{\"type\":\"error\",\"error\":\"Couldn't open a window\"}");
		return 1;
	}
	if (owner)
		SetWindowLongPtrW (ed->hwnd, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR> (owner));
	if (auto css = U::cast<IPlugViewContentScaleSupport> (ed->view))
		css->setContentScaleFactor (dpiScale (ed->hwnd));
	ed->view->setFrame (ed.get ());
	if (ed->view->attached (ed->hwnd, kPlatformTypeHWND) != kResultTrue)
	{
		sendLine ("{\"type\":\"error\",\"error\":\"The plug-in's window wouldn't open\"}");
		return 1;
	}
	// Some plug-ins only settle on a size once they're attached.
	ViewRect settled {};
	if (ed->view->getSize (&settled) == kResultTrue && settled.getWidth () > 0 &&
	    (settled.getWidth () != size.getWidth () || settled.getHeight () != size.getHeight ()))
		ed->resizeView (ed->view, &settled);
	ShowWindow (ed->hwnd, SW_SHOW);
	SetForegroundWindow (ed->hwnd);
	SetTimer (ed->hwnd, kFlushTimer, 30, nullptr);
	SetTimer (ed->hwnd, kPollTimer, 1000, nullptr);
	sendLine ("{\"type\":\"open\",\"name\":" + jsonStr (ed->plug.name) + "}");

	// Commands from the app; the pipe closing means the app went away.
	HWND target = ed->hwnd;
	std::thread ([target] {
		std::string cmd;
		while (readLine (cmd))
		{
			if (cmd == "close")
				break;
			if (cmd == "focus")
				PostMessageW (target, WM_HOST_FOCUS, 0, 0);
		}
		PostMessageW (target, WM_CLOSE, 0, 0);
	}).detach ();

	MSG msg;
	while (GetMessageW (&msg, nullptr, 0, 0) > 0)
	{
		TranslateMessage (&msg);
		DispatchMessageW (&msg);
	}
	sendLine ("{\"type\":\"closed\"}");
	ed->data.unprepare ();
	ed->plug.unload ();
	gEditor = nullptr;
	ed.release (); // Plug-ins sometimes call back during teardown; let the process end take it.
	return 0;
}

#include "session_engine.h"

} // namespace

int wmain (int argc, wchar_t** argv)
{
	claimStdout ();
	using SetCtx = BOOL (WINAPI*) (HANDLE);
	if (auto fn = reinterpret_cast<SetCtx> (GetProcAddress (GetModuleHandleW (L"user32.dll"), "SetProcessDpiAwarenessContext")))
		fn (reinterpret_cast<HANDLE> (-4)); // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
	OleInitialize (nullptr);
	SetErrorMode (SEM_FAILCRITICALERRORS | SEM_NOOPENFILEERRORBOX);

	std::vector<std::string> args;
	for (int i = 1; i < argc; i++)
		args.push_back (StringConvert::convert (reinterpret_cast<const char16_t*> (argv[i])));
	int rc = 2;
	if (!args.empty () && args[0] == "list")
		rc = runList ();
	else if (args.size () >= 2 && args[0] == "scan")
		rc = runScan (args[1]);
	else if (!args.empty () && args[0] == "process")
		rc = runProcess ();
	else if (!args.empty () && args[0] == "session")
		rc = runSession ();
	else if (!args.empty () && args[0] == "session-render")
		rc = runSessionRender ();
	else if (!args.empty () && args[0] == "edit")
	{
		HWND owner = nullptr;
		if (args.size () >= 3 && args[1] == "--owner")
			owner = reinterpret_cast<HWND> (static_cast<uintptr_t> (_strtoui64 (args[2].c_str (), nullptr, 10)));
		rc = runEdit (owner);
	}
	else
		sendLine ("{\"ok\":false,\"error\":\"usage: vsthost list | scan <module> | process | edit [--owner HWND]\"}");
	fflush (gOut);
	// Some plug-ins hang or crash in their unload code; nothing is left to save by now.
	TerminateProcess (GetCurrentProcess (), static_cast<UINT> (rc));
	return rc;
}
