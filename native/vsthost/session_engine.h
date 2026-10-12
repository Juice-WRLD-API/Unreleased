// Included after the existing VST host types. A persistent native transport and
// mixer; the pipe carries commands/assets, never the realtime audio stream.
#include "session_dsp.h"

constexpr int sessionBlock = 256;

struct SessionPlugin : IComponentHandler
{
	Plug plug;
	HostProcessData data;
	ParameterChanges input, output;
	EventList eventsIn, eventsOut;
	ProcessContext context {};
	std::string id, path, cid, state, initialState;
	uint32 latency {};
	std::atomic<int32> restartFlags {0};
	~SessionPlugin () { if(plug.controller) plug.controller->setComponentHandler(nullptr); plug.stop(); data.unprepare(); }
	tresult PLUGIN_API queryInterface (const TUID iid, void** object) override {
		if(FUnknownPrivate::iidEqual(iid,IComponentHandler::iid) || FUnknownPrivate::iidEqual(iid,FUnknown::iid)) { *object=static_cast<IComponentHandler*>(this); return kResultTrue; }
		*object=nullptr; return kNoInterface;
	}
	uint32 PLUGIN_API addRef () override { return 1000; }
	uint32 PLUGIN_API release () override { return 1000; }
	tresult PLUGIN_API beginEdit (ParamID) override { return kResultOk; }
	tresult PLUGIN_API endEdit (ParamID) override { return kResultOk; }
	tresult PLUGIN_API performEdit (ParamID id, ParamValue value) override { int32 q=0,p=0; if(auto* changes=input.addParameterData(id,q)) changes->addPoint(0,value,p); return kResultOk; }
	tresult PLUGIN_API restartComponent (int32 flags) override { restartFlags.fetch_or(flags); return kResultOk; }
	void refresh (double sr) {
		int32 flags=restartFlags.exchange(0);
		if(flags & kReloadComponent) throw std::runtime_error(plug.name+": requested a reload; restart playback");
		if(flags & (kLatencyChanged|kIoChanged)) { plug.stop(); data.unprepare(); start(sr); }
		if((flags & kParamValuesChanged) && plug.controller) for(int32 i=0;i<plug.controller->getParameterCount();i++) {
			ParameterInfo info{};
			if(plug.controller->getParameterInfo(i,info)==kResultOk) performEdit(info.id,plug.controller->getParamNormalized(info.id));
		}
	}
	void start (double sr) {
		std::string error;
		if(!plug.start(sr,sessionBlock,kRealtime,error)) throw std::runtime_error(error);
		data.prepare(*plug.component,sessionBlock,kSample32);
		if(data.numOutputs<1 || data.outputs[0].numChannels<1) throw std::runtime_error("The plug-in has no audio output");
		data.processMode=kRealtime; data.inputParameterChanges=&input; data.outputParameterChanges=&output;
		data.inputEvents=&eventsIn; data.outputEvents=&eventsOut; data.processContext=&context;
		latency=plug.processor->getLatencySamples();
		if(latency>sr*30) throw std::runtime_error("The plug-in reports more than 30 seconds of latency");
	}
	void load (const Json& p, double sr) {
		id=p["id"].str(); path=p["path"].str(); cid=p["cid"].str(); state=p["state"].str();
		std::string error;
		if(!plug.load(path,cid,error)) throw std::runtime_error(error);
		initialState=plug.getState();
		int32 count=plug.controller ? plug.controller->getParameterCount() : 0;
		input.setMaxParameters(count); output.setMaxParameters(count);
		if(plug.controller) plug.controller->setComponentHandler(this);
		if(!state.empty() && !plug.setState(state)) throw std::runtime_error("Invalid plug-in state");
		start(sr);
	}
	void restore (const std::string& s, double sr) {
		if(s==state) return;
		if(plug.getState()==s) { state=s; return; }
		plug.stop(); data.unprepare();
		if(!plug.setState(s.empty()?initialState:s)) throw std::runtime_error("Invalid plug-in state");
		state=s; start(sr);
	}
	void parameter (ParamID id, double value) {
		value=unit(value);
		if(plug.controller) plug.controller->setParamNormalized(id,value);
		int32 q=0,p=0; if(auto* changes=input.addParameterData(id,q)) changes->addPoint(0,value,p);
	}
	void process (float audio[2][sessionBlock], int n, double sr, double bpm, double time, bool playing) {
		for(int b=0;b<data.numInputs;b++) {
			auto& bus=data.inputs[b]; bus.silenceFlags=0;
			for(int c=0;c<bus.numChannels;c++) for(int i=0;i<n;i++)
				bus.channelBuffers32[c][i]=b==0 ? (bus.numChannels==1 ? (audio[0][i]+audio[1][i])*.5f : audio[std::min(c,1)][i]) : 0;
		}
		for(int b=0;b<data.numOutputs;b++) for(int c=0;c<data.outputs[b].numChannels;c++)
			std::fill_n(data.outputs[b].channelBuffers32[c],n,0.f);
		fillContext(context,sr,bpm,static_cast<int64>(time*sr));
		if(!playing) context.state &= ~ProcessContext::kPlaying;
		data.numSamples=n;
		output.clearQueue(); eventsOut.clear();
		if(plug.processor->process(data)!=kResultOk) throw std::runtime_error(plug.name+": processing failed");
		input.clearQueue();
		for(int c=0;c<2;c++) std::copy_n(data.outputs[0].channelBuffers32[std::min(c,data.outputs[0].numChannels-1)],n,audio[c]);
	}
};

struct SessionAsset { double sr {}; std::vector<std::vector<float>> channels; };
struct SessionClip {
	std::shared_ptr<SessionAsset> asset;
	double start {}, offset {}, length {}, rate {1}, gain {1}, fadeIn {}, fadeOut {};
	std::vector<std::pair<double,double>> silence;
	float sample (double t, int c) const {
		double u=t-start;
		if(!asset || u<0 || u>=length) return 0;
		double at=(offset+u*rate)*asset->sr;
		const auto& samples=asset->channels[std::min<size_t>(c,asset->channels.size()-1)];
		if(at<0 || at>=samples.size()) return 0;
		size_t i=static_cast<size_t>(at); double frac=at-i;
		double g=gain;
		if(fadeIn>0) g*=unit(u/fadeIn);
		if(fadeOut>0) g*=unit((length-u)/fadeOut);
		double comp=1;
		for(auto& span:silence) {
			double down=span.first<=0 ? 0 : unit((span.first+.005-u)/.01);
			double up=span.second>=length ? 0 : unit((u-(span.second-.005))/.01);
			comp=std::min(comp,std::max(down,up));
		}
		return static_cast<float>((samples[i]*(1-frac)+(i+1<samples.size()?samples[i+1]:0)*frac)*g*comp);
	}
};

struct SessionLane {
	std::string id;
	std::vector<SessionClip> clips;
	std::vector<std::unique_ptr<SessionPlugin>> plugins;
	LaneDsp dsp;
	double gain {1}, pan {}, sends[3] {}, latency {};
	bool audible {true};
};

struct SessionMixer {
	double sr {48000}, position {}, bpm {120}, master {1}, ab {}, abTarget {}, end {}, loopStart {}, loopEnd {};
	double startedFrom {};
	int64 renderedFrames {};
	bool playing {false}, loop {false};
	std::map<std::string,std::shared_ptr<SessionAsset>> assets;
	std::vector<std::unique_ptr<SessionLane>> lanes;
	SessionClip reference;
	SendDsp sends;
	Compressor limiter;
	explicit SessionMixer (double rate=48000) : sr(rate) { sends.init(sr); limiter.set(-1.5,20,.001,.12,0,1,sr); }
	SessionClip clip (const Json& c) {
		SessionClip out;
		auto it=assets.find(c["asset"].str());
		if(it==assets.end()) throw std::runtime_error("Audio asset missing");
		out.asset=it->second; out.start=c["start"].num(); out.offset=c["offset"].num(); out.length=c["length"].num();
		out.rate=c["rate"].num(1); out.gain=c["gain"].num(1); out.fadeIn=c["fadeIn"].num(); out.fadeOut=c["fadeOut"].num();
		for(auto& s:c["silence"].a) if(s.a.size()==2) out.silence.emplace_back(s.a[0].num(),s.a[1].num());
		return out;
	}
	void configure (const Json& p, bool timeline) {
		bpm=p["bpm"].num(120); master=p["masterGain"].num(1); sends.set(p);
		std::vector<std::unique_ptr<SessionLane>> next;
		bool solo=false; for(auto& t:p["tracks"].a) solo |= t["solo"].b;
		for(auto& t:p["tracks"].a) {
			std::unique_ptr<SessionLane> lane;
			for(auto& old:lanes) if(old && old->id==t["id"].str()) { lane=std::move(old); break; }
			if(!lane) { lane=std::make_unique<SessionLane>(); lane->id=t["id"].str(); }
			lane->gain=t["gain"].num(1); lane->pan=std::clamp(t["pan"].num(),-1.,1.);
			lane->audible=!t["muted"].b && (!solo || t["solo"].b);
			lane->dsp.set(t["chain"],sr);
			lane->sends[0]=unit(t["fx"]["reverb"].num())*.9;
			lane->sends[1]=unit(t["fx"]["echo"].num())*.7;
			lane->sends[2]=unit(t["fx"]["chorus"].num())*.7;
			std::vector<std::unique_ptr<SessionPlugin>> chain;
			lane->latency=0;
			for(auto& spec:t["plugins"].a) {
				if(spec["bypass"].b) continue;
				std::unique_ptr<SessionPlugin> plugin;
				for(auto& old:lane->plugins) if(old && old->id==spec["id"].str() && old->path==spec["path"].str() && old->cid==spec["cid"].str()) { plugin=std::move(old); break; }
				if(!plugin) { plugin=std::make_unique<SessionPlugin>(); plugin->load(spec,sr); }
				else plugin->restore(spec["state"].str(),sr);
				lane->latency+=plugin->latency/sr;
				chain.push_back(std::move(plugin));
			}
			lane->plugins=std::move(chain);
			if(timeline) { lane->clips.clear(); for(auto& c:t["clips"].a) lane->clips.push_back(clip(c)); }
			next.push_back(std::move(lane));
		}
		lanes=std::move(next);
		if(timeline) {
			reference=p["reference"].kind==Json::Obj ? clip(p["reference"]) : SessionClip{};
			end=p["end"].num(); loopStart=p["loop"]["start"].num(); loopEnd=p["loop"]["end"].num();
			loop=p["loop"].kind==Json::Obj && loopEnd-loopStart>.05;
			// Retain only the assets used by the current arrangement.
			for(auto it=assets.begin();it!=assets.end();) { if(it->second.use_count()==1) it=assets.erase(it); else ++it; }
		}
	}
	void edit (const Json& cmd) {
		for(auto& lane:lanes) for(auto& p:lane->plugins) if(p->id==cmd["pluginId"].str()) {
			bool target=cmd["lanes"].a.empty(); for(auto& id:cmd["lanes"].a) target |= id.str()==lane->id;
			if(!target) continue;
			if(cmd["op"].str()=="parameter") p->parameter(static_cast<ParamID>(cmd["param"].num()),cmd["value"].num());
			else p->restore(cmd["state"].str(),sr);
			lane->latency=0; for(auto& plugin:lane->plugins) lane->latency+=plugin->latency/sr;
		}
	}
	double timelineTime (double t) const { return loop && t>=loopEnd ? loopStart+std::fmod(t-loopStart,loopEnd-loopStart) : t; }
	void render (float* output, int n) {
		float mix[2][sessionBlock] {}, rev[2][sessionBlock] {}, ech[2][sessionBlock] {}, cho[2][sessionBlock] {};
		for(auto& lane:lanes) {
			lane->latency=0; for(auto& p:lane->plugins) { p->refresh(sr); lane->latency+=p->latency/sr; }
			float audio[2][sessionBlock] {};
			for(int i=0;i<n;i++) {
				double t=timelineTime(position+i/sr+lane->latency);
				for(auto& c:lane->clips) { audio[0][i]+=c.sample(t,0); audio[1][i]+=c.sample(t,1); }
			}
			double pluginTime=position+lane->latency;
			for(auto& p:lane->plugins) { p->process(audio,n,sr,bpm,pluginTime,playing); pluginTime-=p->latency/sr; }
			for(int i=0;i<n;i++) {
				float l=audio[0][i]*static_cast<float>(lane->gain), r=audio[1][i]*static_cast<float>(lane->gain);
				lane->dsp.tick(l,r);
				double pan=lane->pan;
				if(pan<=0) { double a=(pan+1)*pi/2; l+=r*static_cast<float>(std::cos(a)); r*=static_cast<float>(std::sin(a)); }
				else { double a=pan*pi/2; r+=l*static_cast<float>(std::sin(a)); l*=static_cast<float>(std::cos(a)); }
				if(!lane->audible) l=r=0;
				float v[2] {l,r};
				for(int c=0;c<2;c++) { mix[c][i]+=v[c]; rev[c][i]+=v[c]*static_cast<float>(lane->sends[0]); ech[c][i]+=v[c]*static_cast<float>(lane->sends[1]); cho[c][i]+=v[c]*static_cast<float>(lane->sends[2]); }
			}
		}
		for(int i=0;i<n;i++) {
			float l=mix[0][i], r=mix[1][i], rv[2] {rev[0][i],rev[1][i]}, ec[2] {ech[0][i],ech[1][i]}, ch[2] {cho[0][i],cho[1][i]};
			sends.tick(rv,ec,ch,l,r); limiter.tick(l,r);
			double time=timelineTime(position+i/sr); ab+=(abTarget-ab)/(sr*.01);
			l=static_cast<float>((l*(1-ab)+reference.sample(time,0)*ab)*master);
			r=static_cast<float>((r*(1-ab)+reference.sample(time,1)*ab)*master);
			output[2*i]=std::isfinite(l)?l:0; output[2*i+1]=std::isfinite(r)?r:0;
		}
		position=timelineTime(position+n/sr);
		renderedFrames+=n;
	}
	void seek (double from) {
		for(auto& lane:lanes) { lane->dsp.clear(); for(auto& p:lane->plugins) { p->plug.stop(); p->data.unprepare(); p->start(sr); } }
		sends.clear(); limiter.envelope=0;
		double warm=0; for(auto& lane:lanes) warm=std::max(warm,lane->latency);
		int frames=static_cast<int>(std::ceil(warm*sr)); position=from-frames/sr;
		float scratch[sessionBlock*2];
		while(frames>0) { int n=std::min(frames,sessionBlock); render(scratch,n); frames-=n; }
		position=startedFrom=from; renderedFrames=0;
	}
};

struct SessionDevice {
	IMMDeviceEnumerator* enumerator {};
	IMMDevice* device {};
	IAudioClient* client {};
	IAudioRenderClient* render {};
	HANDLE event {CreateEventW(nullptr,FALSE,FALSE,nullptr)};
	UINT32 frames {};
	~SessionDevice () { if(client) client->Stop(); if(render) render->Release(); if(client) client->Release(); if(device) device->Release(); if(enumerator) enumerator->Release(); CloseHandle(event); }
	void check (HRESULT hr) { if(FAILED(hr)) throw std::runtime_error("Windows audio device failed ("+std::to_string(static_cast<unsigned long>(hr))+")"); }
	void open () {
		check(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,__uuidof(IMMDeviceEnumerator),reinterpret_cast<void**>(&enumerator)));
		check(enumerator->GetDefaultAudioEndpoint(eRender,eMultimedia,&device));
		check(device->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,reinterpret_cast<void**>(&client)));
		WAVEFORMATEX format {}; format.wFormatTag=WAVE_FORMAT_IEEE_FLOAT; format.nChannels=2; format.nSamplesPerSec=48000;
		format.wBitsPerSample=32; format.nBlockAlign=8; format.nAvgBytesPerSec=384000;
		check(client->Initialize(AUDCLNT_SHAREMODE_SHARED,AUDCLNT_STREAMFLAGS_EVENTCALLBACK|AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM|AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,200000,0,&format,nullptr));
		check(client->SetEventHandle(event)); check(client->GetBufferSize(&frames));
		check(client->GetService(__uuidof(IAudioRenderClient),reinterpret_cast<void**>(&render)));
	}
	void stop () { if(client) { check(client->Stop()); check(client->Reset()); } }
	void fill (SessionMixer& mixer) {
		UINT32 padding=0; check(client->GetCurrentPadding(&padding)); UINT32 count=frames-padding;
		if(!count) return;
		BYTE* raw=nullptr; check(render->GetBuffer(count,&raw));
		try { for(UINT32 at=0;at<count;) { int n=std::min<int>(sessionBlock,count-at); mixer.render(reinterpret_cast<float*>(raw)+at*2,n); at+=n; } }
		catch(...) { render->ReleaseBuffer(count,AUDCLNT_BUFFERFLAGS_SILENT); throw; }
		check(render->ReleaseBuffer(count,0));
	}
};

struct SessionCommand { Json json; std::shared_ptr<SessionAsset> asset; };

struct SessionEvents {
	std::mutex lock;
	std::condition_variable changed;
	std::deque<std::string> queue;
	bool stopping {false};
	std::thread writer;
	SessionEvents () : writer([this] {
		for(;;) {
			std::string message;
			{ std::unique_lock<std::mutex> guard(lock); changed.wait(guard,[this]{return stopping || !queue.empty();});
				if(queue.empty()) return; message=std::move(queue.front()); queue.pop_front(); }
			sendLine(message);
		}
	}) {}
	void send (std::string message, bool position=false) {
		{ std::lock_guard<std::mutex> guard(lock); if(position && queue.size()>8) return; queue.push_back(std::move(message)); }
		changed.notify_one();
	}
	~SessionEvents () { { std::lock_guard<std::mutex> guard(lock); stopping=true; } changed.notify_one(); writer.join(); }
};

struct AudioScheduling {
	HMODULE library {LoadLibraryW(L"avrt.dll")};
	HANDLE task {};
	AudioScheduling () {
		if(!library) return;
		auto set=reinterpret_cast<decltype(&AvSetMmThreadCharacteristicsW)>(GetProcAddress(library,"AvSetMmThreadCharacteristicsW"));
		auto priority=reinterpret_cast<decltype(&AvSetMmThreadPriority)>(GetProcAddress(library,"AvSetMmThreadPriority"));
		DWORD index=0; if(set) task=set(L"Audio",&index); if(task && priority) priority(task,AVRT_PRIORITY_HIGH);
	}
	~AudioScheduling () {
		if(library) { auto revert=reinterpret_cast<decltype(&AvRevertMmThreadCharacteristics)>(GetProcAddress(library,"AvRevertMmThreadCharacteristics")); if(task && revert) revert(task); FreeLibrary(library); }
	}
};

std::shared_ptr<SessionAsset> readSessionAsset (const Json& head) {
	int channels=static_cast<int>(head["channels"].num());
	int64 frames=static_cast<int64>(head["frames"].num());
	if(channels<1 || channels>2 || frames<1 || frames>48000LL*60*60) throw std::runtime_error("Invalid audio asset size");
	auto asset=std::make_shared<SessionAsset>(); asset->sr=head["sampleRate"].num();
	if(asset->sr<8000 || asset->sr>384000) throw std::runtime_error("Invalid audio asset sample rate");
	asset->channels.resize(channels);
	for(auto& c:asset->channels) { c.resize(static_cast<size_t>(frames)); if(!readExact(c.data(),c.size()*sizeof(float))) throw std::runtime_error("Audio asset cut short"); }
	return asset;
}

// Export shares the native mixer, including its built-in effects and VST chain,
// so a Windows bounce matches what was monitored. No audio device is opened.
int runSessionRender () {
	try {
		std::map<std::string,std::shared_ptr<SessionAsset>> assets;
		std::string line; Json head;
		for(;;) {
			head=Json{};
			if(!readLine(line) || !parseJson(line,head)) throw std::runtime_error("Incomplete render request");
			if(head["op"].str()!="asset") break;
			assets[head["id"].str()]=readSessionAsset(head);
		}
		double rate=head["sampleRate"].num(48000);
		if(rate<8000 || rate>192000) throw std::runtime_error("Unsupported render sample rate");
		SessionMixer mixer(rate); mixer.assets=std::move(assets); mixer.configure(head["project"],true);
		mixer.loop=false; mixer.playing=true; mixer.seek(0);
		int64 frames=static_cast<int64>(std::ceil(head["duration"].num()*rate));
		if(frames<=0 || frames>rate*60*60) throw std::runtime_error("Invalid render duration");
		std::vector<float> left(static_cast<size_t>(frames)), right(static_cast<size_t>(frames));
		float block[sessionBlock*2];
		for(int64 at=0;at<frames;) {
			int n=static_cast<int>(std::min<int64>(sessionBlock,frames-at)); mixer.render(block,n);
			for(int i=0;i<n;i++) { left[at+i]=block[i*2]; right[at+i]=block[i*2+1]; } at+=n;
		}
		sendLine("{\"ok\":true,\"channels\":2,\"frames\":"+std::to_string(frames)+"}");
		fwrite(left.data(),sizeof(float),left.size(),gOut); fwrite(right.data(),sizeof(float),right.size(),gOut); fflush(gOut);
		return 0;
	} catch(const std::exception& error) { sendLine("{\"ok\":false,\"error\":"+jsonStr(error.what())+"}"); return 1; }
}

int runSession () {
	SessionMixer mixer;
	SessionDevice device;
	SessionEvents events;
	HANDLE changed=CreateEventW(nullptr,FALSE,FALSE,nullptr);
	std::mutex mutex;
	std::vector<SessionCommand> commands;
	std::atomic<bool> eof {false};
	std::thread reader([&] {
		std::string line;
		try {
		while(readLine(line)) {
			SessionCommand command;
			if(!parseJson(line,command.json)) break;
			if(command.json["op"].str()=="asset") {
				command.asset=readSessionAsset(command.json);
			}
			{ std::lock_guard<std::mutex> lock(mutex); commands.push_back(std::move(command)); }
			SetEvent(changed);
		}
		} catch(const std::exception& error) { sendLine("{\"type\":\"error\",\"error\":"+jsonStr(error.what())+"}"); }
		eof=true; SetEvent(changed);
	});
	// Fatal errors terminate the helper, including a reader blocked on stdin.
	try {
		device.open(); events.send("{\"type\":\"ready\"}");
		AudioScheduling scheduling;
		HANDLE waits[2] {changed,device.event}; DWORD lastStatus=0;
		for(;;) {
			WaitForMultipleObjects(2,waits,FALSE,50);
			MSG message;
			while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)) { TranslateMessage(&message); DispatchMessageW(&message); }
			if(eof) break;
			std::vector<SessionCommand> work;
			{ std::lock_guard<std::mutex> lock(mutex); work.swap(commands); }
			for(auto& command:work) {
				auto& c=command.json; auto op=c["op"].str();
				if(op=="asset") mixer.assets[c["id"].str()]=std::move(command.asset);
				else if(op=="play") {
					device.stop(); mixer.playing=false; mixer.configure(c["project"],true);
					mixer.ab=mixer.abTarget=c["ab"].str()=="ref"?1:0;
					mixer.seek(c["from"].num()); mixer.playing=true; device.fill(mixer); device.check(device.client->Start());
				}
				else if(op=="mix") mixer.configure(c["project"],false);
				else if(op=="parameter" || op=="state") mixer.edit(c);
				else if(op=="ab") mixer.abTarget=c["value"].str()=="ref"?1:0;
				else if(op=="pause") { device.stop(); mixer.playing=false; }
				else if(op=="close") { device.stop(); mixer.playing=false; sendLine("{\"type\":\"closed\"}"); TerminateProcess(GetCurrentProcess(),0); }
				events.send("{\"type\":\"ack\",\"request\":"+std::to_string(static_cast<int64>(c["request"].num()))+"}");
			}
			if(mixer.playing) {
				device.fill(mixer);
				if(GetTickCount()-lastStatus>=50) {
					lastStatus=GetTickCount(); UINT32 pending=0; device.check(device.client->GetCurrentPadding(&pending));
					double pos=mixer.timelineTime(mixer.startedFrom+std::max<int64>(0,mixer.renderedFrames-pending)/mixer.sr);
					events.send("{\"type\":\"position\",\"position\":"+std::to_string(std::max(0.,pos))+"}",true);
				}
			}
		}
	}
	catch(const std::exception& error) { sendLine("{\"type\":\"error\",\"error\":"+jsonStr(error.what())+"}"); TerminateProcess(GetCurrentProcess(),1); }
	reader.join(); CloseHandle(changed);
	return 0;
}
