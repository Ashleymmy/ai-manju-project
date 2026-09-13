FROM golang:1.23-alpine@sha256:383395b794dffa5b53012a212365d40c8e37109a626ca30d6151c8348d380b5f AS builder

WORKDIR /src
ENV GOPROXY=https://goproxy.cn,https://proxy.golang.org,direct

COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api ./
RUN go build -o /out/ai-manju-api ./cmd/server
RUN go build -o /out/ai-manju-asset-export-worker ./cmd/asset-export-worker
RUN go build -o /out/ai-manju-sd-video-bridge ./cmd/sd-video-bridge

FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc

RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /out/ai-manju-api /app/ai-manju-api
COPY --from=builder /out/ai-manju-asset-export-worker /app/ai-manju-asset-export-worker
COPY --from=builder /out/ai-manju-sd-video-bridge /app/ai-manju-sd-video-bridge
RUN mkdir -p /app/data/assets && chmod 1777 /app/data/assets

ENV HOST=0.0.0.0
ENV PORT=3101

EXPOSE 3101
CMD ["/app/ai-manju-api"]
