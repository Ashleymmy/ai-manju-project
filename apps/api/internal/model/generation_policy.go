package model

import "time"

const (
	// GenerationAttemptsPerProvider includes the first request, then two retries.
	GenerationAttemptsPerProvider = 3
	// Media requests need enough time for a loaded supplier to finish generation.
	GenerationMediaRequestTimeout = 15 * time.Minute
	GenerationTextRequestTimeout  = 5 * time.Minute
	// Allow output persistence and cancellation handling before Celery kills a delivery.
	GenerationPersistenceTimeout = 5 * time.Minute
	GenerationHardTimeoutGrace   = time.Minute
)
