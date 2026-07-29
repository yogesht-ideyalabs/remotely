/**
 * Kubernetes Cluster Browser
 *
 * Browse namespaces, pods, deployments, services, and view pod logs
 * for any configured Kubernetes connection.
 *
 * Author: Yogesh Tiwari
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";

interface PodInfo {
  name: string;
  namespace: string;
  status: string;
  ready: string;
  restarts: number;
  age: string;
  ip: string;
  node: string;
  containers: { name: string; image: string; ready: boolean; restarts: number }[];
  labels: Record<string, string>;
}

interface DeploymentInfo {
  name: string;
  namespace: string;
  replicas: string;
  age: string;
  labels: Record<string, string>;
  containers: { name: string; image: string }[];
}

interface ServiceInfo {
  name: string;
  namespace: string;
  type: string;
  clusterIP: string;
  ports: string;
  age: string;
  selector: Record<string, string>;
}

type Tab = "pods" | "deployments" | "services" | "logs";

export default function KubernetesBrowser() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNs, setSelectedNs] = useState("default");
  const [tab, setTab] = useState<Tab>("pods");
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [deployments, setDeployments] = useState<DeploymentInfo[]>([]);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [logs, setLogs] = useState("");
  const [logPod, setLogPod] = useState("");
  const [logContainer, setLogContainer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connectionId) return;
    apiFetch(`/api/k8s/${connectionId}/namespaces`)
      .then((ns) => { setNamespaces(ns); if (ns.length && !ns.includes(selectedNs)) setSelectedNs(ns[0]); })
      .catch((e) => setError(e.message));
  }, [connectionId]);

  useEffect(() => {
    if (!connectionId || !selectedNs) return;
    loadTab();
  }, [connectionId, selectedNs, tab]);

  async function loadTab() {
    setLoading(true);
    setError("");
    try {
      switch (tab) {
        case "pods":
          setPods(await apiFetch(`/api/k8s/${connectionId}/pods?namespace=${selectedNs}`));
          break;
        case "deployments":
          setDeployments(await apiFetch(`/api/k8s/${connectionId}/deployments?namespace=${selectedNs}`));
          break;
        case "services":
          setServices(await apiFetch(`/api/k8s/${connectionId}/services?namespace=${selectedNs}`));
          break;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function viewLogs(podName: string, container?: string) {
    setLogPod(podName);
    setLogContainer(container || "");
    setTab("logs");
    setLoading(true);
    try {
      const data = await apiFetch(`/api/k8s/${connectionId}/pods/${podName}/logs?namespace=${selectedNs}${container ? `&container=${container}` : ""}&tail=200`);
      setLogs(data.logs || "No logs available.");
    } catch (e) {
      setLogs("Error fetching logs: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page k8s-browser-page">
      <div className="k8s-header">
        <h1>☸️ Kubernetes Cluster</h1>
        <div className="k8s-controls">
          <label>
            Namespace:
            <select value={selectedNs} onChange={(e) => setSelectedNs(e.target.value)}>
              {namespaces.map((ns) => <option key={ns} value={ns}>{ns}</option>)}
            </select>
          </label>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="k8s-tabs">
        <button className={tab === "pods" ? "active" : ""} onClick={() => setTab("pods")}>Pods</button>
        <button className={tab === "deployments" ? "active" : ""} onClick={() => setTab("deployments")}>Deployments</button>
        <button className={tab === "services" ? "active" : ""} onClick={() => setTab("services")}>Services</button>
        {logPod && <button className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>Logs: {logPod}</button>}
      </div>

      {loading && <div className="loading-bar">Loading...</div>}

      {tab === "pods" && !loading && (
        <div className="k8s-table-wrap">
          <table className="k8s-table">
            <thead>
              <tr><th>Name</th><th>Status</th><th>Ready</th><th>Restarts</th><th>Age</th><th>IP</th><th>Node</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {pods.map((pod) => (
                <tr key={pod.name}>
                  <td className="pod-name">{pod.name}</td>
                  <td><span className={`status-badge status-${pod.status.toLowerCase()}`}>{pod.status}</span></td>
                  <td>{pod.ready}</td>
                  <td>{pod.restarts}</td>
                  <td>{pod.age}</td>
                  <td className="mono">{pod.ip}</td>
                  <td>{pod.node}</td>
                  <td>
                    <button className="btn-sm" onClick={() => viewLogs(pod.name)}>Logs</button>
                    {pod.containers.length > 1 && pod.containers.map((c) => (
                      <button key={c.name} className="btn-sm" onClick={() => viewLogs(pod.name, c.name)} title={`Logs for ${c.name}`}>
                        📦 {c.name}
                      </button>
                    ))}
                    <a className="btn-sm" href={`/terminal/${connectionId}`}>Exec</a>
                  </td>
                </tr>
              ))}
              {pods.length === 0 && <tr><td colSpan={8} className="empty">No pods in this namespace</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "deployments" && !loading && (
        <div className="k8s-table-wrap">
          <table className="k8s-table">
            <thead>
              <tr><th>Name</th><th>Replicas</th><th>Age</th><th>Containers</th></tr>
            </thead>
            <tbody>
              {deployments.map((dep) => (
                <tr key={dep.name}>
                  <td className="pod-name">{dep.name}</td>
                  <td>{dep.replicas}</td>
                  <td>{dep.age}</td>
                  <td>{dep.containers.map((c) => c.image).join(", ")}</td>
                </tr>
              ))}
              {deployments.length === 0 && <tr><td colSpan={4} className="empty">No deployments in this namespace</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "services" && !loading && (
        <div className="k8s-table-wrap">
          <table className="k8s-table">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Cluster IP</th><th>Ports</th><th>Age</th></tr>
            </thead>
            <tbody>
              {services.map((svc) => (
                <tr key={svc.name}>
                  <td className="pod-name">{svc.name}</td>
                  <td>{svc.type}</td>
                  <td className="mono">{svc.clusterIP}</td>
                  <td>{svc.ports}</td>
                  <td>{svc.age}</td>
                </tr>
              ))}
              {services.length === 0 && <tr><td colSpan={5} className="empty">No services in this namespace</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "logs" && (
        <div className="k8s-logs">
          <div className="logs-header">
            <span>Pod: <b>{logPod}</b>{logContainer && <> / Container: <b>{logContainer}</b></>}</span>
            <button className="btn-sm" onClick={() => viewLogs(logPod, logContainer || undefined)}>Refresh</button>
          </div>
          <pre className="logs-content">{logs}</pre>
        </div>
      )}
    </div>
  );
}
