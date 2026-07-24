/**
 * Docker/Podman Container Discovery
 *
 * Discovers running containers and their network configuration
 * by calling the Docker socket API or TCP endpoint.
 *
 * Author: Yogesh Tiwari
 */

import { execSync } from "node:child_process";
import type { DiscoveredResource } from "./infraCollector.js";

interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Ports: { PrivatePort: number; PublicPort?: number; Type: string; IP?: string }[];
  NetworkSettings: {
    Networks: Record<string, { IPAddress: string; Gateway: string; NetworkID: string }>;
  };
  Labels: Record<string, string>;
}

/**
 * Collect Docker containers via `docker ps` CLI (avoids needing socket access).
 */
export function collectDockerContainers(): DiscoveredResource[] {
  const resources: DiscoveredResource[] = [];

  try {
    // Check if docker is available
    execSync("docker version --format '{{.Client.Version}}'", { encoding: "utf8", timeout: 5000 });
  } catch {
    // Docker not available, try podman
    try {
      execSync("podman version --format '{{.Client.Version}}'", { encoding: "utf8", timeout: 5000 });
      return collectPodmanContainers();
    } catch {
      return resources; // Neither docker nor podman available
    }
  }

  try {
    const output = execSync(
      "docker ps -a --format '{{json .}}' 2>/dev/null",
      { encoding: "utf8", timeout: 10000 }
    );

    const lines = output.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const container = JSON.parse(line) as {
          ID: string;
          Names: string;
          Image: string;
          State: string;
          Status: string;
          Ports: string;
          Labels: string;
          Networks: string;
        };

        const ports = parsePorts(container.Ports);
        const labels = parseLabels(container.Labels);
        const networks = container.Networks?.split(",").map((n) => n.trim()) || [];

        resources.push({
          externalId: `docker-${container.ID}`,
          provider: "on-prem",
          region: "local",
          type: "container",
          name: container.Names || container.ID.slice(0, 12),
          properties: {
            image: container.Image,
            state: container.State,
            status: container.Status,
            ports,
            runtime: "docker",
          },
          relationships: [],
          tags: {
            ...labels,
            "container.runtime": "docker",
            "container.image": container.Image,
          },
          networkInfo: {
            privateIps: [], // Would need `docker inspect` for IPs
          },
        });
      } catch {
        // Skip malformed lines
      }
    }

    // Also discover Docker networks
    try {
      const networkOutput = execSync(
        "docker network ls --format '{{json .}}' 2>/dev/null",
        { encoding: "utf8", timeout: 5000 }
      );

      const networkLines = networkOutput.trim().split("\n").filter(Boolean);
      for (const line of networkLines) {
        try {
          const network = JSON.parse(line) as {
            ID: string;
            Name: string;
            Driver: string;
            Scope: string;
          };

          // Skip default networks
          if (["bridge", "host", "none"].includes(network.Name)) continue;

          resources.push({
            externalId: `docker-net-${network.ID.slice(0, 12)}`,
            provider: "on-prem",
            region: "local",
            type: "vpc",
            name: `Docker: ${network.Name}`,
            properties: {
              driver: network.Driver,
              scope: network.Scope,
              runtime: "docker",
            },
            relationships: [],
            tags: { "network.driver": network.Driver },
            networkInfo: {},
          });
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Network listing failed, continue
    }

  } catch (err) {
    console.error("[docker-collector] Failed:", (err as Error).message);
  }

  return resources;
}

/**
 * Collect Podman containers (same format as Docker).
 */
function collectPodmanContainers(): DiscoveredResource[] {
  const resources: DiscoveredResource[] = [];

  try {
    const output = execSync(
      "podman ps -a --format '{{json .}}' 2>/dev/null",
      { encoding: "utf8", timeout: 10000 }
    );

    const lines = output.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const container = JSON.parse(line) as {
          Id: string;
          Names: string;
          Image: string;
          State: string;
          Status: string;
          Ports: string;
          Labels: Record<string, string>;
        };

        resources.push({
          externalId: `podman-${container.Id?.slice(0, 12) || "unknown"}`,
          provider: "on-prem",
          region: "local",
          type: "container",
          name: container.Names || container.Id?.slice(0, 12) || "unknown",
          properties: {
            image: container.Image,
            state: container.State,
            status: container.Status,
            runtime: "podman",
          },
          relationships: [],
          tags: {
            ...(container.Labels || {}),
            "container.runtime": "podman",
            "container.image": container.Image,
          },
          networkInfo: {},
        });
      } catch {
        // Skip malformed
      }
    }
  } catch (err) {
    console.error("[podman-collector] Failed:", (err as Error).message);
  }

  return resources;
}

/**
 * Discover services listening on ports (basic service fingerprinting).
 */
export function collectListeningServices(): DiscoveredResource[] {
  const resources: DiscoveredResource[] = [];

  try {
    // Use lsof or ss to find listening TCP ports
    let output: string;
    try {
      output = execSync(
        "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null",
        { encoding: "utf8", timeout: 5000 }
      );
    } catch {
      return resources;
    }

    const lines = output.split("\n").filter((l) => l.includes("LISTEN"));
    const seenPorts = new Set<number>();

    for (const line of lines) {
      // Extract port and process name
      const portMatch = line.match(/:(\d+)\s/);
      const processMatch = line.match(/users:\(\("([^"]+)"/);

      if (portMatch) {
        const port = parseInt(portMatch[1], 10);
        if (seenPorts.has(port)) continue;
        seenPorts.add(port);

        const processName = processMatch?.[1] || "unknown";
        const serviceName = identifyService(port, processName);

        resources.push({
          externalId: `service-port-${port}`,
          provider: "on-prem",
          region: "local",
          type: "other",
          name: serviceName,
          properties: {
            port,
            process: processName,
            protocol: "tcp",
          },
          relationships: [],
          tags: { "service.port": String(port), "service.process": processName },
          networkInfo: {},
        });
      }
    }
  } catch {
    // Service detection failed silently
  }

  return resources;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsePorts(portsStr: string): { port: number; proto: string; public?: number }[] {
  if (!portsStr) return [];
  const parts = portsStr.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.map((p) => {
    const match = p.match(/(?:(\d+\.\d+\.\d+\.\d+):)?(\d+)->(\d+)\/(\w+)/);
    if (match) {
      return { port: parseInt(match[3], 10), proto: match[4], public: parseInt(match[2], 10) };
    }
    const simpleMatch = p.match(/(\d+)\/(\w+)/);
    if (simpleMatch) {
      return { port: parseInt(simpleMatch[1], 10), proto: simpleMatch[2] };
    }
    return { port: 0, proto: "tcp" };
  }).filter((p) => p.port > 0);
}

function parseLabels(labelsStr: string): Record<string, string> {
  if (!labelsStr) return {};
  const result: Record<string, string> = {};
  const pairs = labelsStr.split(",");
  for (const pair of pairs) {
    const [key, ...valueParts] = pair.split("=");
    if (key) result[key.trim()] = valueParts.join("=").trim();
  }
  return result;
}

function identifyService(port: number, processName: string): string {
  const wellKnown: Record<number, string> = {
    22: "SSH",
    80: "HTTP",
    443: "HTTPS",
    3306: "MySQL",
    5432: "PostgreSQL",
    6379: "Redis",
    27017: "MongoDB",
    8080: "HTTP (alt)",
    8443: "HTTPS (alt)",
    9090: "Prometheus",
    3000: "Grafana/Node",
    5000: "Flask/Registry",
    8888: "Jupyter",
    9200: "Elasticsearch",
    5672: "RabbitMQ",
    4222: "NATS",
    2379: "etcd",
    6443: "Kubernetes API",
    10250: "Kubelet",
  };

  return wellKnown[port] || `${processName}:${port}`;
}
