package queue

import (
	"context"
	"errors"

	"github.com/ai-manju/api/internal/model"
)

var ErrBrokerNotConfigured = errors.New("celery broker is not configured")

type TaskMessage struct {
	TaskName string
	Queue    string
	JobID    string
	Payload  model.JSONB
	Kwargs   map[string]any
}

type Producer interface {
	Publish(ctx context.Context, message TaskMessage) error
}

type MemoryProducer struct {
	Messages []TaskMessage
}

func (p *MemoryProducer) Publish(ctx context.Context, message TaskMessage) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	p.Messages = append(p.Messages, message)
	return nil
}
