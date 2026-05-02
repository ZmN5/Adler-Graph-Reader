# syntax=docker/dockerfile:1

# Build stage
FROM rust:1.82-slim-bookworm AS builder

WORKDIR /app

# Install dependencies for sqlite and SSL
RUN apt-get update && apt-get install -y \
    pkg-config \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests and build dependencies first (for layer caching)
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release && rm -rf src

# Copy source code and build
COPY src ./src
RUN touch src/main.rs
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

# Create data directory
RUN mkdir -p /app/data/books /app/data/backups

# Copy binary
COPY --from=builder /app/target/release/reader-backend /app/

EXPOSE 8080

CMD ["./reader-backend"]
