package service

import (
	"errors"
	"testing"
)

func TestNormalizeImageGenerationParametersMatchesWorkbenchSemantics(t *testing.T) {
	tests := []struct {
		name        string
		size        string
		quality     string
		wantSize    string
		wantQuality string
	}{
		{name: "auto", size: "auto", quality: "auto", wantSize: "", wantQuality: ""},
		{name: "explicit", size: "1824x1024", quality: "high", wantSize: "1824x1024", wantQuality: "high"},
		{name: "default ratio", size: "16:9", quality: "auto", wantSize: "1824x1024", wantQuality: ""},
		{name: "portrait ratio", size: "9:16", quality: "auto", wantSize: "1024x1824", wantQuality: ""},
		{name: "quality alias", size: "1:1", quality: "2k", wantSize: "2048x2048", wantQuality: "medium"},
		{name: "legacy quality", size: "1:1", quality: "hd", wantSize: "2048x2048", wantQuality: "hd"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeImageGenerationParameters(test.size, test.quality, "PNG")
			if err != nil {
				t.Fatalf("NormalizeImageGenerationParameters() error = %v", err)
			}
			if got.Size != test.wantSize || got.Quality != test.wantQuality || got.OutputFormat != "png" {
				t.Fatalf("NormalizeImageGenerationParameters() = %#v, want size=%q quality=%q format=png", got, test.wantSize, test.wantQuality)
			}
		})
	}
}

func TestNormalizeImageGenerationParametersRejectsInvalidInput(t *testing.T) {
	if _, err := NormalizeImageGenerationParameters("1000x1000", "auto", "png"); !errors.Is(err, ErrImageGenerationSizeInvalid) {
		t.Fatalf("size error = %v, want ErrImageGenerationSizeInvalid", err)
	}
	if _, err := NormalizeImageGenerationParameters("4:1", "auto", "png"); !errors.Is(err, ErrImageGenerationSizeInvalid) {
		t.Fatalf("ratio error = %v, want ErrImageGenerationSizeInvalid", err)
	}
	if _, err := NormalizeImageGenerationParameters("1:1", "ultra", "png"); !errors.Is(err, ErrImageGenerationQualityInvalid) {
		t.Fatalf("quality error = %v, want ErrImageGenerationQualityInvalid", err)
	}
}
