// DSP used by the native Session Maker mixer. No allocation in the sample loop.
#pragma once

constexpr double pi = 3.14159265358979323846;
double unit (double x) { return std::clamp (x, 0., 1.); }
double dbGain (double x) { return std::pow (10., x / 20.); }

struct Biquad
{
	double b0 {1}, b1 {}, b2 {}, a1 {}, a2 {};
	double z1[2] {}, z2[2] {};
	void set (int type, double hz, double q, double db, double sr)
	{
		double w = 2 * pi * std::clamp (hz, 1., sr * .49) / sr;
		double c = std::cos (w), s = std::sin (w), alpha = s / (2 * q), A = std::pow (10., db / 40.), a0;
		if (type == 0) { b0 = (1-c)/2; b1 = 1-c; b2 = b0; a0 = 1+alpha; a1 = -2*c; a2 = 1-alpha; }
		else if (type == 1) { b0 = (1+c)/2; b1 = -(1+c); b2 = b0; a0 = 1+alpha; a1 = -2*c; a2 = 1-alpha; }
		else if (type == 2) { b0 = 1+alpha*A; b1 = -2*c; b2 = 1-alpha*A; a0 = 1+alpha/A; a1 = -2*c; a2 = 1-alpha/A; }
		else {
			double t = s * std::sqrt (2*A);
			b0 = A*((A+1)+(A-1)*c+t); b1 = -2*A*((A-1)+(A+1)*c); b2 = A*((A+1)+(A-1)*c-t);
			a0 = (A+1)-(A-1)*c+t; a1 = 2*((A-1)-(A+1)*c); a2 = (A+1)-(A-1)*c-t;
		}
		b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
	}
	float tick (float x, int ch) { double y = b0*x+z1[ch]; z1[ch] = b1*x-a1*y+z2[ch]; z2[ch] = b2*x-a2*y; return static_cast<float> (y); }
	void clear () { std::fill (z1, z1+2, 0.); std::fill (z2, z2+2, 0.); }
};

struct Compressor
{
	double envelope {}, threshold {}, ratio {1}, makeup {1}, attack {}, release {}, knee {};
	void set (double t, double r, double a, double rel, double k, double m, double sr)
	{ threshold=t; ratio=r; attack=std::exp(-1/(a*sr)); release=std::exp(-1/(rel*sr)); knee=k; makeup=m; }
	void tick (float& l, float& r)
	{
		double level = std::max (std::abs(l), std::abs(r));
		double c = level > envelope ? attack : release;
		envelope = c*envelope+(1-c)*level;
		double over = 20*std::log10(std::max(envelope, 1e-12))-threshold, reduction = 0;
		if (knee > 0 && over > -knee/2 && over < knee/2) reduction = (1/ratio-1)*std::pow(over+knee/2,2)/(2*knee);
		else if (over > 0) reduction = (1/ratio-1)*over;
		float g = static_cast<float>(dbGain(reduction)*makeup); l *= g; r *= g;
	}
};

struct LaneDsp
{
	Biquad low, presence, air, hp, lp;
	Compressor comp;
	double drive {};
	void set (const Json& c, double sr)
	{
		double cut=unit(c["lowCut"].num()), v=unit(c["comp"].num());
		low.set(1, cut > 0 ? 40*std::pow(7.5,cut) : 10, .7071, 0, sr);
		double threshold=-10-20*v, ratio=1+5*v;
		double anchor=-14, out=anchor <= threshold ? anchor : threshold+(anchor-threshold)/ratio;
		comp.set(v > 0 ? threshold : 0, ratio, .004, .18, v > 0 ? 6 : 0, dbGain(anchor-out), sr);
		presence.set(2,3500,.9,8*unit(c["presence"].num()),sr);
		air.set(3,10000,.7071,8*unit(c["air"].num()),sr);
		drive=unit(c["lofi"].num());
		hp.set(1,20*std::pow(25.,drive),.7071,0,sr); lp.set(0,20000/std::pow(7.,drive),.7071,0,sr);
	}
	void tick (float& l, float& r)
	{
		l=low.tick(l,0); r=low.tick(r,1); comp.tick(l,r);
		float* channels[2] {&l,&r};
		for (int c=0;c<2;c++) {
			float v=lp.tick(hp.tick(air.tick(presence.tick(*channels[c],c),c),c),c);
			if (drive>0) { double k=1+3*drive; v=static_cast<float>(std::tanh(k*v)/(std::tanh(k)*std::sqrt(k))); }
			*channels[c]=v;
		}
	}
	void clear () { low.clear(); presence.clear(); air.clear(); hp.clear(); lp.clear(); comp.envelope=0; }
};

struct DelayLine
{
	std::vector<float> samples;
	size_t at {};
	void init (size_t n) { samples.assign(n+2,0); at=0; }
	float read (double delay) const {
		double p=static_cast<double>(at)-std::clamp(delay,1.,static_cast<double>(samples.size()-1));
		if(p<0) p+=samples.size();
		size_t i=static_cast<size_t>(p); double f=p-i;
		return static_cast<float>(samples[i]*(1-f)+samples[(i+1)%samples.size()]*f);
	}
	void push (float v) { samples[at]=v; at=(at+1)%samples.size(); }
	void clear () { std::fill(samples.begin(),samples.end(),0.f); at=0; }
};

// A small feedback delay network for the native reverb; intentionally independent
// of Chromium's randomized convolution implementation.
struct SendDsp
{
	DelayLine echo[2], chorus[2], pre[2], room[2][4];
	Biquad tone;
	double sr {48000}, echoTime {.375}, targetEcho {.375}, seconds {1.7}, preTime {.02}, phase {};
	void init (double rate) {
		sr=rate;
		for(int c=0;c<2;c++) {
			echo[c].init(static_cast<size_t>(sr*2)); chorus[c].init(static_cast<size_t>(sr*.1)); pre[c].init(static_cast<size_t>(sr*.1));
			for(int j=0;j<4;j++) room[c][j].init(static_cast<size_t>(sr*(.0297+j*.0071+c*.0017)));
		}
		tone.set(0,4200,.7071,0,sr);
	}
	void set (const Json& p) { targetEcho=std::clamp(p["echoSeconds"].num(.375),.01,1.9); seconds=p["reverbSeconds"].num(1.7); preTime=p["preDelay"].num(.02); }
	void tick (float rev[2], float ech[2], float cho[2], float& l, float& r) {
		float* out[2] {&l,&r}; echoTime+=(targetEcho-echoTime)/(sr*.03);
		for(int c=0;c<2;c++) {
			float e=tone.tick(echo[c].read(echoTime*sr),c); echo[c].push(ech[c]+e*.42f); *out[c]+=e;
			float pred=pre[c].read(preTime*sr); pre[c].push(rev[c]);
			float sum=0;
			for(int j=0;j<4;j++) {
				auto& d=room[c][j]; double delay=static_cast<double>(d.samples.size()-2);
				float v=d.read(delay); d.push(pred+v*static_cast<float>(std::pow(.001,delay/(sr*seconds)))); sum+=v;
			}
			*out[c]+=sum*.225f;
			float a=chorus[c].read(sr*(.022+.004*std::sin(phase*.6)));
			float b=chorus[c].read(sr*(.031+.004*std::sin(phase*.9)));
			chorus[c].push(cho[c]); *out[c]+=(a+b)*.7f;
		}
		phase+=2*pi/sr; if(phase>20*pi) phase-=20*pi;
	}
	void clear () { for(int c=0;c<2;c++) { echo[c].clear(); chorus[c].clear(); pre[c].clear(); for(auto& d:room[c]) d.clear(); } tone.clear(); }
};
