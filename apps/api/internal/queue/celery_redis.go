package queue

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const redisCommandTimeout = 5 * time.Second

type CeleryRedisProducer struct {
	brokerURL string
	queueName string
}

func NewCeleryRedisProducer(brokerURL string, queueName string) *CeleryRedisProducer {
	queueName = strings.TrimSpace(queueName)
	if queueName == "" {
		queueName = "celery"
	}
	return &CeleryRedisProducer{brokerURL: strings.TrimSpace(brokerURL), queueName: queueName}
}

func (p *CeleryRedisProducer) Publish(ctx context.Context, message TaskMessage) error {
	if p.brokerURL == "" {
		return ErrBrokerNotConfigured
	}
	if strings.TrimSpace(message.Queue) == "" {
		message.Queue = p.queueName
	}
	payload, err := celeryMessagePayload(message)
	if err != nil {
		return err
	}
	return redisLPush(ctx, p.brokerURL, message.Queue, string(payload))
}

func celeryMessagePayload(message TaskMessage) ([]byte, error) {
	var payload any = map[string]any{}
	if len(message.Payload) > 0 {
		if err := json.Unmarshal(message.Payload, &payload); err != nil {
			return nil, err
		}
	}
	kwargs := map[string]any{
		"job_id":  message.JobID,
		"payload": payload,
	}
	for key, value := range message.Kwargs {
		if key == "job_id" || key == "payload" {
			continue
		}
		kwargs[key] = value
	}
	bodyTuple := []any{
		[]any{message.JobID},
		kwargs,
		map[string]any{
			"callbacks": nil,
			"errbacks":  nil,
			"chain":     nil,
			"chord":     nil,
		},
	}
	bodyJSON, err := json.Marshal(bodyTuple)
	if err != nil {
		return nil, err
	}
	envelope := map[string]any{
		"body":             base64.StdEncoding.EncodeToString(bodyJSON),
		"content-encoding": "utf-8",
		"content-type":     "application/json",
		"headers": map[string]any{
			"lang":        "py",
			"task":        message.TaskName,
			"id":          message.JobID,
			"root_id":     message.JobID,
			"retries":     0,
			"eta":         nil,
			"expires":     nil,
			"group":       nil,
			"group_index": nil,
		},
		"properties": map[string]any{
			"correlation_id": message.JobID,
			"delivery_tag":   message.JobID,
			"reply_to":       "",
			"delivery_mode":  2,
			"delivery_info": map[string]any{
				"exchange":    "",
				"routing_key": message.Queue,
			},
			"body_encoding": "base64",
		},
	}
	return json.Marshal(envelope)
}

func redisLPush(ctx context.Context, rawURL string, key string, value string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	address := parsed.Host
	if !strings.Contains(address, ":") {
		address += ":6379"
	}
	dialer := net.Dialer{Timeout: redisCommandTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(redisCommandTimeout))
	reader := bufio.NewReader(conn)

	if parsed.User != nil {
		password, _ := parsed.User.Password()
		username := parsed.User.Username()
		if password != "" {
			if username != "" {
				if err := redisCommand(conn, reader, "AUTH", username, password); err != nil {
					return err
				}
			} else if err := redisCommand(conn, reader, "AUTH", password); err != nil {
				return err
			}
		}
	}
	if dbIndex := strings.Trim(parsed.Path, "/"); dbIndex != "" {
		if _, err := strconv.Atoi(dbIndex); err == nil {
			if err := redisCommand(conn, reader, "SELECT", dbIndex); err != nil {
				return err
			}
		}
	}
	return redisCommand(conn, reader, "LPUSH", key, value)
}

func redisCommand(conn net.Conn, reader *bufio.Reader, args ...string) error {
	if _, err := fmt.Fprintf(conn, "*%d\r\n", len(args)); err != nil {
		return err
	}
	for _, arg := range args {
		if _, err := fmt.Fprintf(conn, "$%d\r\n%s\r\n", len(arg), arg); err != nil {
			return err
		}
	}
	line, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	if strings.HasPrefix(line, "-") {
		return fmt.Errorf("redis error: %s", strings.TrimSpace(line[1:]))
	}
	return nil
}
