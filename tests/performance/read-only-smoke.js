import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.PERF_BASE_URL || "http://127.0.0.1:3000";

export const options = {
  scenarios: {
    read_only: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 5 },
        { duration: "40s", target: 10 },
        { duration: "20s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
  },
};

export default function runReadOnlySmoke() {
  const path = ["/", "/login", "/register", "/templates", "/api/health/backend"][Math.floor(Math.random() * 5)];
  const response = http.get(`${baseUrl}${path}`, { tags: { endpoint: path } });
  check(response, {
    "response is not a server error": (value) => value.status < 500,
  });
  sleep(1);
}
