import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./Layout";
import Login from "./pages/Login";
import Resources from "./pages/Resources";
import TerminalPage from "./pages/Terminal";
import RdpConsole from "./pages/RdpConsole";
import Database from "./pages/Database";
import Audit from "./pages/Audit";
import Recordings from "./pages/Recordings";
import Replay from "./pages/Replay";
import Users from "./pages/Users";
import Roles from "./pages/Roles";
import Connections from "./pages/Connections";
import Organizations from "./pages/Organizations";
import AgentHealth from "./pages/AgentHealth";
import Files from "./pages/Files";
import Sessions from "./pages/Sessions";
import Profile from "./pages/Profile";
import SsoCallback from "./pages/SsoCallback";
import Dashboard from "./pages/Dashboard";
import WatchSession from "./pages/WatchSession";
import AccessRequests from "./pages/AccessRequests";
import SiemExport from "./pages/SiemExport";
import Compliance from "./pages/Compliance";
import Plugins from "./pages/Plugins";
import Notifications from "./pages/Notifications";
import InfraMap from "./pages/InfraMap";
import Snapshots from "./pages/Snapshots";
import DiagramEditor from "./pages/DiagramEditor";
import Architecture from "./pages/Architecture";
import SharedDiagram from "./pages/SharedDiagram";
import Monitors from "./pages/Monitors";
import SecurityPolicy from "./pages/SecurityPolicy";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/sso-callback" element={<SsoCallback />} />
        <Route path="/share/:token" element={<SharedDiagram />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/resources" replace />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/terminal/:resourceId" element={<TerminalPage />} />
          <Route path="/rdp/:resourceId" element={<RdpConsole />} />
          <Route path="/db/:resourceId" element={<Database />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/recordings" element={<Recordings />} />
          <Route path="/recordings/:sessionId" element={<Replay />} />
          <Route path="/admin/connections" element={<Connections />} />
          <Route path="/admin/users" element={<Users />} />
          <Route path="/admin/roles" element={<Roles />} />
          <Route path="/admin/organizations" element={<Organizations />} />
          <Route path="/admin/siem" element={<SiemExport />} />
          <Route path="/admin/compliance" element={<Compliance />} />
          <Route path="/admin/plugins" element={<Plugins />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/admin/agents" element={<AgentHealth />} />
          <Route path="/files/:resourceId" element={<Files />} />
          <Route path="/active-sessions" element={<Sessions />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/watch/:sessionId" element={<WatchSession />} />
          <Route path="/access-requests" element={<AccessRequests />} />
          <Route path="/admin/infra-map" element={<InfraMap />} />
          <Route path="/admin/snapshots" element={<Snapshots />} />
          <Route path="/admin/diagram-editor" element={<DiagramEditor />} />
          <Route path="/admin/architecture" element={<Architecture />} />
          <Route path="/admin/monitors" element={<Monitors />} />
          <Route path="/admin/security-policy" element={<SecurityPolicy />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
