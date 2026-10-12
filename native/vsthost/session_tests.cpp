// Standalone headless tests, linked against the same SDK objects as vsthost.
// Optional arguments: installed VST3 module path and class ID.
#define wmain hostMain
#include "vsthost.cpp"
#undef wmain

void require (bool ok, const char* message) { if(!ok) throw std::runtime_error(message); }
Json json (const std::string& source) { Json value; require(parseJson(source,value),"Test JSON failed"); return value; }

int wmain (int argc, wchar_t** argv) {
	claimStdout(); OleInitialize(nullptr);
	try {
		auto asset=std::make_shared<SessionAsset>(); asset->sr=48000;
		asset->channels.resize(1); asset->channels[0].resize(48000);
		for(int i=0;i<48000;i++) asset->channels[0][i]=static_cast<float>(.05*std::sin(2*pi*1000*i/48000));
		SessionMixer mixer; mixer.assets["a"]=asset;
		auto project=json(R"({"masterGain":1,"bpm":120,"loop":{"start":0.1,"end":0.2},"tracks":[{"id":"one","gain":1,"clips":[{"asset":"a","start":0,"offset":0,"length":1}]}],"reference":{"asset":"a","start":0,"offset":0,"length":1}})");
		mixer.configure(project,true); mixer.seek(.195); mixer.playing=true;
		float output[sessionBlock*2]; mixer.render(output,sessionBlock);
		require(std::abs(mixer.position-(.195+sessionBlock/48000.-.1))<1e-9,"Loop did not wrap at the sample boundary");
		mixer.loop=false; mixer.seek(.15); mixer.ab=mixer.abTarget=1;
		mixer.render(output,sessionBlock);
		for(int i=0;i<sessionBlock;i++) require(std::abs(output[i*2]-asset->channels[0][7200+i])<1e-6,"Reference playback moved out of sync");
		sendLine("PASS: loop boundaries and reference alignment");

		if(argc>=3) {
			std::string path=StringConvert::convert(reinterpret_cast<const char16_t*>(argv[1]));
			std::string cid=StringConvert::convert(reinterpret_cast<const char16_t*>(argv[2]));
			SessionPlugin plugin;
			plugin.load(json("{\"id\":\"test\",\"path\":"+jsonStr(path)+",\"cid\":"+jsonStr(cid)+"}"),48000);
			require(plugin.plug.controller!=nullptr,"Test plugin has no controller");
			ParamID gain=0; bool found=false;
			for(int i=0;i<plugin.plug.controller->getParameterCount();i++) {
				ParameterInfo info{}; plugin.plug.controller->getParameterInfo(i,info);
				auto title=StringConvert::convert(info.title);
				std::string lower=title; std::transform(lower.begin(),lower.end(),lower.begin(),[](unsigned char c){return static_cast<char>(std::tolower(c));});
				if(lower.find("gain")!=std::string::npos && lower.find("out")!=std::string::npos) { gain=info.id; found=true; break; }
			}
			require(found,"Test plugin has no output gain parameter");
			auto energy=[&] {
				double sum=0; float audio[2][sessionBlock];
				for(int b=0;b<400;b++) {
					for(int i=0;i<sessionBlock;i++) audio[0][i]=audio[1][i]=static_cast<float>(.01*std::sin(2*pi*1000*(b*sessionBlock+i)/48000));
					plugin.process(audio,sessionBlock,48000,120,b*sessionBlock/48000.,true);
					if(b>200) for(int i=0;i<sessionBlock;i++) { require(std::isfinite(audio[0][i]),"Plugin produced nonfinite audio"); sum+=audio[0][i]*audio[0][i]; }
				}
				return sum;
			};
			double before=energy(); auto* instance=plugin.plug.processor.get();
			plugin.parameter(gain,.9); double after=energy();
			require(instance==plugin.plug.processor.get(),"Parameter change recreated the processor");
			require(before>0 && after>before*1.5,"Live output gain change did not reach the running processor");
			require(plugin.input.getParameterCount()==0,"Delivered parameter queue was not cleared");
			sendLine("PASS: live VST3 output-gain update on the same processor instance");
		}
		TerminateProcess(GetCurrentProcess(),0);
	} catch(const std::exception& e) { sendLine(std::string("FAIL: ")+e.what()); TerminateProcess(GetCurrentProcess(),1); }
	return 1;
}
