package service

import (
	"errors"
	"testing"

	"github.com/ai-manju/api/internal/model"
)

func TestAutomaticVideoCreditsDecimalBoundary(t *testing.T) {
	for _, tc := range []struct {
		name     string
		rate     int64
		seconds  float64
		discount int64
		want     int64
	}{
		{"whole_credit_at_1_1_seconds", 70, 1.1, 10000, 77},
		{"whole_credit_at_4_03_seconds", 100, 4.03, 10000, 403},
		{"whole_credit_at_16_12_seconds", 25, 16.12, 10000, 403},
		{"discounted_whole_credit", 70, 2.2, 5000, 77},
		{"real_fraction_must_round_up", 100, 4.03001, 10000, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := automaticVideoCredits(tc.rate*videoCreditRatePrecision, tc.seconds, tc.discount); got != tc.want {
				t.Fatalf("rate=%d seconds=%g discount=%d: credits=%d, want %d", tc.rate, tc.seconds, tc.discount, got, tc.want)
			}
		})
	}
}

// Resolution names identify the supplier's price tier, not necessarily the
// shorter decoded edge. These fixtures deliberately do not assign supplier
// semantics to their square/ultrawide dimensions.
func TestAutomaticVideoBillingExplicitTierDoesNotInferFromGeometry(t *testing.T) {
	for _, dims := range [][2]int{{960, 960}, {1472, 640}, {720, 1280}} {
		f := newLifecycleFixture(t, nil)
		job, _ := reserveAutomaticVideo(t, f, `{"model":"seedance-2.0","duration":-1,"resolution":"720p"}`, &VideoBillingPolicy{MaxDurationSeconds: 15, Resolutions: []string{"720p"}})
		job.Result = measuredVideoResult(5, dims[0], dims[1])
		outcome, err := f.engine.SettleCompletedJob(job)
		if err != nil || outcome.Consumption.CreditsSettled != 500 {
			t.Fatalf("dimensions=%v settlement=%+v error=%v", dims, outcome, err)
		}
	}
}

func TestAutomaticVideoBillingUnambiguousRateDoesNotNeedGeometryInference(t *testing.T) {
	for _, tc := range []struct {
		name        string
		payload     string
		resolutions []string
	}{
		{"one_supported_tier", `{"model":"seedance-2.0","duration":-1}`, []string{"720p"}},
		{"identical_frozen_rates", `{"model":"unlisted-model","duration":-1}`, []string{"480p", "720p"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newLifecycleFixture(t, nil)
			job, reserved := reserveAutomaticVideo(t, f, tc.payload, &VideoBillingPolicy{MaxDurationSeconds: 15, Resolutions: tc.resolutions})
			job.Result = measuredVideoResult(5, 960, 960)
			outcome, err := f.engine.SettleCompletedJob(job)
			if err != nil || outcome.Consumption.CreditsSettled != reserved.CreditsQuoted/3 {
				t.Fatalf("unambiguous rate remained frozen: settlement=%+v error=%v", outcome, err)
			}
		})
	}
}

func TestAutomaticVideoBillingAmbiguousRateKeepsReservation(t *testing.T) {
	f := newLifecycleFixture(t, nil)
	job, reserved := reserveAutomaticVideo(t, f, `{"model":"seedance-2.5","duration":-1}`, &VideoBillingPolicy{MaxDurationSeconds: 30, Resolutions: []string{"720p", "1080p"}})
	job.Result = measuredVideoResult(5, 960, 960)
	if _, err := f.engine.SettleCompletedJob(job); !errors.Is(err, ErrVideoBillingMetricsPending) {
		t.Fatalf("ambiguous supplier tier accepted: %v", err)
	}
	after, err := f.credits.GetConsumptionByJobID(job.ID)
	if err != nil || after.Status != model.TaskConsumptionStatusReserved || after.CreditsQuoted != reserved.CreditsQuoted {
		t.Fatalf("reservation changed: %+v error=%v", after, err)
	}
}
