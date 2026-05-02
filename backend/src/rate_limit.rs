use axum::{
    body::Body,
    extract::{ConnectInfo, Request},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tower::{Layer, Service};

/// Per-client rate limit state
#[derive(Clone, Debug)]
struct ClientState {
    count: u32,
    window_start: Instant,
}

/// In-memory rate limit store
#[derive(Clone, Debug)]
pub struct RateLimitStore {
    inner: Arc<Mutex<HashMap<String, ClientState>>>,
    max_requests: u32,
    window: Duration,
}

impl RateLimitStore {
    pub fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            max_requests,
            window: Duration::from_secs(window_secs),
        }
    }

    /// Check if the given client key is allowed to proceed.
    /// Returns true if within limit, false if rate limited.
    pub fn check(&self, client_key: &str) -> bool {
        let now = Instant::now();
        let mut map = self.inner.lock().unwrap();

        // Cleanup old entries every ~100 insertions (simple heuristic)
        if map.len() > 1000 {
            map.retain(|_, state| now.duration_since(state.window_start) < self.window * 2);
        }

        match map.get_mut(client_key) {
            Some(state) => {
                if now.duration_since(state.window_start) > self.window {
                    // Window expired, reset
                    state.count = 1;
                    state.window_start = now;
                    true
                } else if state.count < self.max_requests {
                    state.count += 1;
                    true
                } else {
                    false
                }
            }
            None => {
                map.insert(
                    client_key.to_string(),
                    ClientState {
                        count: 1,
                        window_start: now,
                    },
                );
                true
            }
        }
    }
}

/// Rate limit layer for Tower
#[derive(Clone, Debug)]
pub struct RateLimitLayer {
    store: RateLimitStore,
}

impl RateLimitLayer {
    pub fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            store: RateLimitStore::new(max_requests, window_secs),
        }
    }
}

impl<S> Layer<S> for RateLimitLayer {
    type Service = RateLimitService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RateLimitService {
            inner,
            store: self.store.clone(),
        }
    }
}

/// Rate limit service (middleware)
#[derive(Clone, Debug)]
pub struct RateLimitService<S> {
    inner: S,
    store: RateLimitStore,
}

impl<S> Service<Request> for RateLimitService<S>
where
    S: Service<Request, Response = Response> + Clone + Send + 'static,
    S::Future: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = std::pin::Pin<Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut std::task::Context<'_>) -> std::task::Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request) -> Self::Future {
        let mut inner = self.inner.clone();
        let store = self.store.clone();

        Box::pin(async move {
            let client_key = extract_client_key(&req);

            if !store.check(&client_key) {
                let body = Body::from(r#"{"error":"Rate limit exceeded. Please try again later."}"#);
                return Ok((
                    StatusCode::TOO_MANY_REQUESTS,
                    [("content-type", "application/json")],
                    body,
                )
                    .into_response());
            }

            inner.call(req).await
        })
    }
}

/// Extract a client key from the request (prefer X-Forwarded-For, fallback to socket addr)
fn extract_client_key(req: &Request) -> String {
    // Try X-Forwarded-For header first (for reverse proxy setups)
    if let Some(forwarded) = req.headers().get("x-forwarded-for") {
        if let Ok(s) = forwarded.to_str() {
            let first = s.split(',').next().unwrap_or(s).trim();
            if !first.is_empty() {
                return first.to_string();
            }
        }
    }

    // Fallback to ConnectInfo
    if let Some(addr) = req.extensions().get::<ConnectInfo<SocketAddr>>() {
        return addr.ip().to_string();
    }

    "unknown".to_string()
}
