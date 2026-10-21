package provider

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestResolveCosyVoiceModelAndVoice(t *testing.T) {
	// Cloned voice ID is preserved on cosyvoice-v3.5-plus
	m, v := resolveCosyVoiceModelAndVoice("cosyvoice-v3.5-plus", "cosyvoice-v3.5-plus-hero-abc123", true)
	if m != "cosyvoice-v3.5-plus" || v != "cosyvoice-v3.5-plus-hero-abc123" {
		t.Fatalf("expected cloned voice preserved, got model=%s voice=%s", m, v)
	}

	// Default OpenAI voice "alloy" without instruction falls back to cosyvoice-v3-plus + longanyang
	m2, v2 := resolveCosyVoiceModelAndVoice("cosyvoice-v3.5-plus", "alloy", false)
	if m2 != "cosyvoice-v3-plus" || v2 != "longanyang" {
		t.Fatalf("expected cosyvoice-v3-plus/longanyang fallback, got model=%s voice=%s", m2, v2)
	}

	// Default voice with instruction falls back to cosyvoice-v3-flash + longanhuan_v3
	m3, v3 := resolveCosyVoiceModelAndVoice("cosyvoice-v3.5-plus", "alloy", true)
	if m3 != "cosyvoice-v3-flash" || v3 != "longanhuan_v3" {
		t.Fatalf("expected cosyvoice-v3-flash/longanhuan_v3 fallback, got model=%s voice=%s", m3, v3)
	}
}

func TestBailianMiniMaxFunMusicAndVoiceClone(t *testing.T) {
	fakeMP3 := []byte("ID3\x04\x00\x00\x00\x00\x00\x10FAKE_AUDIO_BYTES")
	fakeHex := hex.EncodeToString(fakeMP3)

	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/services/aigc/multimodal-generation/generation":
			var req map[string]any
			_ = json.NewDecoder(r.Body).Decode(&req)
			input, _ := req["input"].(map[string]any)
			if input["action"] == "voice_clone" {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"request_id":"req-mm-clone","output":{"base_resp":{"status_code":0,"status_msg":"success"},"demo_audio":"` + serverURL + `/demo.mp3"}}`))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"request_id":"req-mm-tts","output":{"base_resp":{"status_code":0,"status_msg":"success"},"data":{"audio":"` + fakeHex + `","status":2}}}`))
		case "/api/v1/services/audio/music/generation":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"request_id":"req-music","output":{"audio":{"url":"` + serverURL + `/music.mp3"}}}`))
		case "/api/v1/services/audio/tts/customization":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"request_id":"req-cv-clone","output":{"voice_id":"cosyvoice-v3.5-plus-role-9988"}}`))
		case "/music.mp3", "/demo.mp3":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(fakeMP3)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	serverURL = server.URL

	cfg := model.ModelProviderConfig{
		ID:           "bailian_audio_test",
		Name:         "阿里云百炼音频",
		ProviderType: model.ModelProviderTypeAliyunBailian,
		Mode:         model.ModelProviderModeOpenAICompatible,
		BaseURL:      server.URL,
		AuthType:     model.ModelProviderAuthTypeBearer,
		AudioModel:   DefaultCosyVoiceModel,
		TimeoutMS:    60000,
		Enabled:      true,
	}
	client, err := NewOpenAICompatibleClient(cfg, "sk-test-key")
	if err != nil {
		t.Fatalf("new client: %v", err)
	}

	// 1. MiniMax/speech-2.8-hd synthesis
	audioBytes, contentType, err := client.SynthesizeSpecializedAudio(context.Background(), map[string]any{
		"input":           "今天是不是很开心呀(laughs)！",
		"voice":           "male-qn-qingse",
		"response_format": "mp3",
		"speed":           1.0,
		"emotion":         "happy",
	}, "MiniMax/speech-2.8-hd", nil)
	if err != nil {
		t.Fatalf("MiniMax synthesis failed: %v", err)
	}
	if string(audioBytes) != string(fakeMP3) || contentType != "audio/mpeg" {
		t.Fatalf("unexpected MiniMax audio result: len=%d type=%s", len(audioBytes), contentType)
	}

	// 2. Fun-Music synthesis
	musicBytes, musicType, err := client.SynthesizeSpecializedAudio(context.Background(), map[string]any{
		"input":           "热血动漫片头曲，电吉他与弦乐交织",
		"lyrics":          "[verse]\n破晓之光刺穿云层\n[chorus]\n向着远方奔跑",
		"gender":          "female",
		"is_instrumental": false,
		"response_format": "mp3",
	}, "fun-music-v1", nil)
	if err != nil {
		t.Fatalf("Fun-Music synthesis failed: %v", err)
	}
	if string(musicBytes) != string(fakeMP3) || musicType != "audio/mpeg" {
		t.Fatalf("unexpected Fun-Music result: len=%d type=%s", len(musicBytes), musicType)
	}

	// 3. CosyVoice 3.5 Plus voice cloning
	cvClone, err := client.CreateClonedVoice(context.Background(), VoiceCloneRequest{
		TargetModel: "cosyvoice-v3.5-plus",
		Prefix:      "role",
		AudioURL:    server.URL + "/sample.wav",
	}, nil)
	if err != nil {
		t.Fatalf("CosyVoice clone failed: %v", err)
	}
	if !strings.HasPrefix(cvClone.VoiceID, "cosyvoice-v3.5-plus-role-") {
		t.Fatalf("unexpected CosyVoice cloned voice_id: %s", cvClone.VoiceID)
	}

	// 4. MiniMax/speech-2.8-hd voice cloning
	mmClone, err := client.CreateClonedVoice(context.Background(), VoiceCloneRequest{
		TargetModel: "MiniMax/speech-2.8-hd",
		VoiceID:     "HeroRoleVoice01",
		AudioURL:    server.URL + "/sample.wav",
		Text:        "测试克隆音色试听",
	}, nil)
	if err != nil {
		t.Fatalf("MiniMax clone failed: %v", err)
	}
	if mmClone.VoiceID != "HeroRoleVoice01" || !strings.HasSuffix(mmClone.DemoAudio, "/demo.mp3") {
		t.Fatalf("unexpected MiniMax clone record: %+v", mmClone)
	}
}

func TestSpecializedAudioUpstreamModelReportsCosyVoiceFallback(t *testing.T) {
	client := &OpenAICompatibleClient{}
	if got := client.SpecializedAudioUpstreamModel(map[string]any{"voice": "longanyang"}, "cosyvoice-v3.5-plus"); got != "cosyvoice-v3-plus" {
		t.Fatalf("system voice upstream = %q", got)
	}
	if got := client.SpecializedAudioUpstreamModel(map[string]any{"voice": "cosyvoice-v3.5-plus-hero-abc"}, "cosyvoice-v3.5-plus"); got != "cosyvoice-v3.5-plus" {
		t.Fatalf("cloned voice upstream = %q", got)
	}
	if got := client.SpecializedAudioUpstreamModel(map[string]any{}, "fun-music-v1"); got != "fun-music-v1" {
		t.Fatalf("fun-music upstream = %q", got)
	}
}

func TestLocalVoiceCloneAudioUsesDashScopeOSSReference(t *testing.T) {
	var cloneURL, resolveHeader string
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/uploads":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"policy":"p","signature":"s","upload_dir":"dashscope-instant/abc","upload_host":"` + serverURL + `/oss","oss_access_key_id":"id"}}`))
		case "/oss":
			w.WriteHeader(http.StatusOK)
		case DefaultCosyVoiceCloneEndpoint:
			var req map[string]any
			_ = json.NewDecoder(r.Body).Decode(&req)
			input, _ := req["input"].(map[string]any)
			cloneURL, _ = input["url"].(string)
			resolveHeader = r.Header.Get("X-DashScope-OssResourceResolve")
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"request_id":"req","output":{"voice_id":"cosyvoice-v3.5-plus-role-1"}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	serverURL = server.URL

	client, err := NewOpenAICompatibleClient(model.ModelProviderConfig{
		ID:           "bailian_audio_test",
		ProviderType: model.ModelProviderTypeAliyunBailian,
		Mode:         model.ModelProviderModeOpenAICompatible,
		BaseURL:      server.URL,
		AuthType:     model.ModelProviderAuthTypeBearer,
		TimeoutMS:    60000,
		Enabled:      true,
	}, "sk-test-key")
	if err != nil {
		t.Fatal(err)
	}
	uploaded, err := client.UploadMediaToDashScopeTemp(context.Background(), strings.NewReader("audio"), ".mp3", "voice-enrollment")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(uploaded, "oss://dashscope-instant/abc/") {
		t.Fatalf("uploaded URL = %q, want oss:// reference", uploaded)
	}
	if _, err := client.CreateClonedVoice(context.Background(), VoiceCloneRequest{TargetModel: "cosyvoice-v3.5-plus", AudioURL: uploaded}, nil); err != nil {
		t.Fatal(err)
	}
	if cloneURL != uploaded || resolveHeader != "enable" {
		t.Fatalf("clone url=%q resolve header=%q", cloneURL, resolveHeader)
	}
}

func TestCosyVoiceSystemVoicesUseModelThatHasThem(t *testing.T) {
	for _, tc := range []struct{ model, voice, wantModel, wantVoice string }{
		{"cosyvoice-v3.5-plus", "longanyang", "cosyvoice-v3-plus", "longanyang"},
		{"cosyvoice-v3.5-plus", "longanhuan_v3", "cosyvoice-v3-flash", "longanhuan_v3"},
		{"cosyvoice-v3.5-plus", "longwan_v3", "cosyvoice-v3-flash", "longwan_v3"},
		{"cosyvoice-v3.5-plus", "longwan", "cosyvoice-v3-flash", "longwan_v3"},
		{"cosyvoice-v3.5-plus", "longcheng", "cosyvoice-v3-flash", "longcheng_v3"},
		{"cosyvoice-v3.5-plus", "longxiaochun_v2", "cosyvoice-v3-flash", "longxiaochun_v3"},
		{"cosyvoice-v3-plus", "longshange_v3", "cosyvoice-v3-flash", "longshange_v3"},
		{"cosyvoice-v3-flash", "longwan_v3", "cosyvoice-v3-flash", "longwan_v3"},
	} {
		model, voice := resolveCosyVoiceModelAndVoice(tc.model, tc.voice, false)
		if model != tc.wantModel || voice != tc.wantVoice {
			t.Errorf("%s/%s -> %s/%s, want %s/%s", tc.model, tc.voice, model, voice, tc.wantModel, tc.wantVoice)
		}
	}
}

func TestCosyVoiceInstructionMatchesVoiceFormat(t *testing.T) {
	for _, tc := range []struct{ voice, instruction, want string }{
		{"longanhuan_v3", "河南话表达", "请用河南话表达。"},
		{"longanhuan_v3", "请用四川话表达。", "请用四川话表达。"},
		{"longanhuan_v3", "温柔一点", ""},
		{"longanyang", "开心地读", "你说话的情感是happy。"},
		{"longanhuan", "你说话的情感是sad", "你说话的情感是sad。"},
		{"longwan_v3", "请用河南话表达", ""},
		{"longshange_v3", "开心", ""},
		{"cosyvoice-v3.5-plus-role01-abc", "语速缓慢，沉稳", "语速缓慢，沉稳"},
	} {
		if got := cosyVoiceInstruction(tc.voice, tc.instruction); got != tc.want {
			t.Errorf("%s %q -> %q, want %q", tc.voice, tc.instruction, got, tc.want)
		}
	}
}

func TestCosyVoiceOutputParamsUsePlayableContainers(t *testing.T) {
	cases := map[string]map[string]any{
		"opus": {"format": "opus", "sample_rate": 24000, "bit_rate": 32},
		"wav":  {"format": "wav", "sample_rate": 22050},
		"pcm":  {"format": "mp3", "sample_rate": 22050},
		"":     {"format": "mp3", "sample_rate": 22050},
	}
	for requested, want := range cases {
		got := cosyVoiceOutputParams(requested)
		if len(got) != len(want) {
			t.Fatalf("%q: got %v, want %v", requested, got, want)
		}
		for key, value := range want {
			if got[key] != value {
				t.Fatalf("%q: %s = %v, want %v", requested, key, got[key], value)
			}
		}
	}
	if audioContentTypeForFormat("opus") != "audio/ogg" {
		t.Fatalf("opus content type = %q", audioContentTypeForFormat("opus"))
	}
	if normalizeMiniMaxAudioFormat("pcm") != "mp3" {
		t.Fatalf("MiniMax pcm = %q", normalizeMiniMaxAudioFormat("pcm"))
	}
}

func TestSpecializedAudioRoutingLeavesOtherSuppliersOnStandardProxy(t *testing.T) {
	relay := &OpenAICompatibleClient{config: model.ModelProviderConfig{ProviderType: model.ModelProviderTypeOpenAICompatible, BaseURL: "https://relay.example.com/v1"}}
	for _, modelID := range []string{"cosyvoice-v3-plus", "fun-music-v1", "MiniMax/speech-2.8-hd", "tts-1"} {
		if relay.HandlesSpecializedAudio(modelID) {
			t.Fatalf("relay supplier routed %q away from /audio/speech", modelID)
		}
	}
	bailian := &OpenAICompatibleClient{config: model.ModelProviderConfig{ProviderType: model.ModelProviderTypeAliyunBailian, BaseURL: "https://dashscope.aliyuncs.com"}}
	for _, modelID := range []string{"cosyvoice-v3.5-plus", "fun-music-v1", "MiniMax/speech-2.8-hd"} {
		if !bailian.HandlesSpecializedAudio(modelID) {
			t.Fatalf("Bailian supplier did not route %q to its DashScope path", modelID)
		}
	}
}

func TestDeleteClonedVoice(t *testing.T) {
	var gotVoiceID string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != DefaultCosyVoiceCloneEndpoint {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		input, _ := req["input"].(map[string]any)
		if input["action"] != "delete_voice" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		gotVoiceID, _ = input["voice_id"].(string)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"request_id":"req-del","output":{}}`))
	}))
	defer server.Close()

	cfg := model.ModelProviderConfig{
		ID:           "bailian_audio_delete_test",
		Name:         "阿里云百炼音频",
		ProviderType: model.ModelProviderTypeAliyunBailian,
		Mode:         model.ModelProviderModeOpenAICompatible,
		BaseURL:      server.URL,
		AuthType:     model.ModelProviderAuthTypeBearer,
		TimeoutMS:    60000,
	}
	client, err := NewOpenAICompatibleClient(cfg, "test-key")
	if err != nil {
		t.Fatalf("NewOpenAICompatibleClient: %v", err)
	}
	if err := client.DeleteClonedVoice(context.Background(), "cosyvoice-v3.5-plus-role01-abc123", nil); err != nil {
		t.Fatalf("DeleteClonedVoice: %v", err)
	}
	if gotVoiceID != "cosyvoice-v3.5-plus-role01-abc123" {
		t.Fatalf("voice_id = %q", gotVoiceID)
	}

	// Non-CosyVoice voices are rejected before any HTTP call.
	if err := client.DeleteClonedVoice(context.Background(), "BailianVoice1A2B3C4D", nil); err == nil {
		t.Fatal("expected MiniMax voice deletion to be rejected")
	}
}
