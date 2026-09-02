FROM golang:1.23-alpine AS builder

WORKDIR /src
ENV GOPROXY=https://goproxy.cn,https://proxy.golang.org,direct

COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api ./
RUN go build -o /out/ai-manju-api ./cmd/server
RUN go build -o /out/ai-manju-asset-export-worker ./cmd/asset-export-worker

FROM alpine:3.20

WORKDIR /app
COPY --from=builder /out/ai-manju-api /app/ai-manju-api
COPY --from=builder /out/ai-manju-asset-export-worker /app/ai-manju-asset-export-worker
RUN mkdir -p /app/data/assets && chmod 1777 /app/data/assets

ENV HOST=0.0.0.0
ENV PORT=3101

EXPOSE 3101
CMD ["/app/ai-manju-api"]
