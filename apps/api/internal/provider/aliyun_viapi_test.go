package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ai-manju/api/internal/model"
)

func TestSignAliyunPOPParamsDeterministic(t *testing.T) {
	ts := time.Date(2026, 10, 14, 7, 0, 0, 0, time.UTC)
	params := BuildAliyunPOPSignedParams(
		http.MethodPost,
		DefaultAliyunImageEnhanVersion,
		DefaultAliyunImageUpscaleAction,
		map[string]string{
			"Url":           "https://example.com/input.png",
			"Mode":          "enhancement",
			"UpscaleFactor": "2",
			"OutputFormat":  "jpg",
			"OutputQuality": "95",
		},
		AliyunVIAPICredentials{
			AccessKeyID:     "LTAI5tTestAccessKeyId",
			AccessKeySecret: "TestAccessKeySecretValue",
		},
		ts,
		"nonce-123456",
	)
	if params["Action"] != "MakeSuperResolutionImage" {
		t.Fatalf("unexpected Action: %s", params["Action"])
	}
	if params["Version"] != "2019-09-30" {
		t.Fatalf("unexpected Version: %s", params["Version"])
	}
	if params["Signature"] == "" {
		t.Fatal("expected non-empty Signature")
	}
	expectedSig := SignAliyunPOPParams(http.MethodPost, params, "TestAccessKeySecretValue")
	if params["Signature"] != expectedSig {
		t.Fatalf("signature mismatch: got %s, want %s", params["Signature"], expectedSig)
	}
}

func TestNormalizeImageAndVideoUpscaleRequests(t *testing.T) {
	imgReq, err := NormalizeImageUpscaleRequest(ImageUpscaleRequest{
		URL: "https://example.com/sample.jpg",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if imgReq.Mode != "base" || imgReq.UpscaleFactor != 2 || imgReq.OutputFormat != "jpg" || imgReq.OutputQuality != 95 {
		t.Fatalf("unexpected defaults: %+v", imgReq)
	}

	if _, err := NormalizeImageUpscaleRequest(ImageUpscaleRequest{
		URL: "https://example.com/中文图片.jpg",
	}); err == nil {
		t.Fatal("expected error for URL containing Chinese characters")
	}

	if _, err := NormalizeImageUpscaleRequest(ImageUpscaleRequest{
		URL:           "https://example.com/sample.jpg",
		UpscaleFactor: 5,
	}); err == nil {
		t.Fatal("expected error for upscale_factor > 4")
	}

	vidReq, err := NormalizeVideoUpscaleRequest(VideoUpscaleRequest{
		VideoURL: "https://example.com/sample.mp4",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if vidReq.BitRate != 10 {
		t.Fatalf("expected default bit_rate 10, got %d", vidReq.BitRate)
	}
}

func TestAliyunVIAPIImageAndVideoUpscaleLifecycle(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		action := r.FormValue("Action")
		if r.FormValue("Signature") == "" || r.FormValue("AccessKeyId") != "LTAI_TEST" {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"Code":"InvalidAccessKeyId","Message":"missing signature"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch action {
		case "MakeSuperResolutionImage":
			if r.FormValue("Version") != "2019-09-30" {
				t.Fatalf("unexpected imageenhan version: %s", r.FormValue("Version"))
			}
			if r.FormValue("UpscaleFactor") != "4" || r.FormValue("Mode") != "enhancement" {
				t.Fatalf("unexpected image upscale params: %v", r.Form)
			}
			_, _ = w.Write([]byte(`{"RequestId":"47DD87F6-4090-467E-867D-92229382231B","Data":{"Url":"http://viapi-cn-shanghai-dha-segmenter.oss-cn-shanghai.aliyuncs.com/result_4x.png"}}`))
		case "SuperResolveVideo":
			if r.FormValue("Version") != "2020-03-20" {
				t.Fatalf("unexpected videoenhan version: %s", r.FormValue("Version"))
			}
			if r.FormValue("BitRate") != "8" {
				t.Fatalf("unexpected BitRate: %s", r.FormValue("BitRate"))
			}
			_, _ = w.Write([]byte(`{"RequestId":"186AC396-0EEC-46F1-AAA1-BF3585227427","Message":"该调用为异步调用，任务已提交成功，请以requestId的值作为jobId参数调用同类目下GetAsyncJobResult接口查询任务执行状态和结果。"}`))
		case "GetAsyncJobResult":
			if r.FormValue("JobId") != "186AC396-0EEC-46F1-AAA1-BF3585227427" {
				t.Fatalf("unexpected JobId: %s", r.FormValue("JobId"))
			}
			_, _ = w.Write([]byte(`{"RequestId":"43A0AEB6-45F4-4138-8E89-E1A5D63200E3","Data":{"Status":"PROCESS_SUCCESS","JobId":"186AC396-0EEC-46F1-AAA1-BF3585227427","Result":"{\"VideoUrl\":\"http://algo-app-aic-vd-cn-shanghai-prod.oss-cn-shanghai.aliyuncs.com/upscaled.mp4\"}"}}`))
		default:
			t.Fatalf("unexpected Action: %s", action)
		}
	}))
	defer server.Close()

	overrides, _ := json.Marshal(map[string]string{
		"image_upscale_endpoint": server.URL,
		"video_upscale_endpoint": server.URL,
	})
	cfg := model.ModelProviderConfig{
		ID:                "viapi_test",
		Name:              "阿里云超分",
		ProviderType:      model.ModelProviderTypeAliyunVIAPI,
		Mode:              model.ModelProviderModeOpenAICompatible,
		BaseURL:           server.URL,
		AuthType:          model.ModelProviderAuthTypeNone,
		ImageUpscaleModel: DefaultAliyunImageUpscaleAction,
		VideoUpscaleModel: DefaultAliyunVideoUpscaleAction,
		EndpointOverrides: overrides,
		TimeoutMS:         60000,
		Enabled:           true,
	}
	client, err := NewOpenAICompatibleClient(cfg, "")
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	secrets := map[string]string{
		AliyunAccessKeyIDSecret:     "LTAI_TEST",
		AliyunAccessKeySecretSecret: "SECRET_TEST",
	}

	imgRes, err := client.UpscaleImage(context.Background(), ImageUpscaleRequest{
		URL:           "https://example.com/origin.png",
		Mode:          "enhancement",
		UpscaleFactor: 4,
		OutputFormat:  "png",
	}, secrets)
	if err != nil {
		t.Fatalf("UpscaleImage error: %v", err)
	}
	if !strings.HasSuffix(imgRes.URL, "result_4x.png") || imgRes.RequestID != "47DD87F6-4090-467E-867D-92229382231B" {
		t.Fatalf("unexpected image upscale response: %+v", imgRes)
	}

	taskRes, err := client.CreateVideoUpscaleTask(context.Background(), VideoUpscaleRequest{
		VideoURL: "https://example.com/origin.mp4",
		BitRate:  8,
	}, secrets)
	if err != nil {
		t.Fatalf("CreateVideoUpscaleTask error: %v", err)
	}
	if taskRes.ID != "186AC396-0EEC-46F1-AAA1-BF3585227427" || taskRes.Status != "processing" {
		t.Fatalf("unexpected video upscale task response: %+v", taskRes)
	}

	pollRes, err := client.GetVideoUpscaleTask(context.Background(), taskRes.ID, DefaultAliyunVideoUpscaleAction, secrets)
	if err != nil {
		t.Fatalf("GetVideoUpscaleTask error: %v", err)
	}
	if pollRes.Status != "succeeded" || !strings.HasSuffix(pollRes.VideoURL, "upscaled.mp4") {
		t.Fatalf("unexpected poll response: %+v", pollRes)
	}
}
