import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import PortalLayout from './components/PortalLayout';
import LoginPage from './pages/Login';
import InboxPage from './pages/inbox/InboxPage';
import TicketPage from './pages/inbox/TicketPage';
import KbListPage from './pages/kb/KbListPage';
import KbArticlePage from './pages/kb/KbArticlePage';
import KbHealthPage from './pages/kb/KbHealthPage';
import SopListPage from './pages/sops/SopListPage';
import SopPage from './pages/sops/SopPage';
import MyAcknowledgmentsPage from './pages/sops/MyAcknowledgmentsPage';
import ReportsPage from './pages/reports/ReportsPage';
import SettingsPage from './pages/settings/SettingsPage';
import PortalHome from './pages/portal/PortalHome';
import PortalTicketPage from './pages/portal/PortalTicketPage';
import PortalNewTicket from './pages/portal/PortalNewTicket';
import PortalKbPage from './pages/portal/PortalKbPage';
import PortalArticlePage from './pages/portal/PortalArticlePage';
import PortalLogin from './pages/portal/PortalLogin';
import HelpHome from './pages/help/HelpHome';
import HelpArticle from './pages/help/HelpArticle';
import WidgetPage from './pages/widget/WidgetPage';

export default function App() {
  return (
    <Routes>
      {/* Public help center */}
      <Route path="/help" element={<HelpHome />} />
      <Route path="/help/a/:slug" element={<HelpArticle />} />

      {/* Embeddable widget (search-first deflection + human chat) */}
      <Route path="/widget" element={<WidgetPage />} />

      {/* Customer portal */}
      <Route path="/portal/login" element={<PortalLogin />} />
      <Route element={<PortalLayout />}>
        <Route path="/portal" element={<PortalHome />} />
        <Route path="/portal/new" element={<PortalNewTicket />} />
        <Route path="/portal/tickets/:id" element={<PortalTicketPage />} />
        <Route path="/portal/kb" element={<PortalKbPage />} />
        <Route path="/portal/kb/:slug" element={<PortalArticlePage />} />
      </Route>

      {/* Staff app */}
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/tickets/:id" element={<TicketPage />} />
        <Route path="/kb" element={<KbListPage />} />
        <Route path="/kb/health" element={<KbHealthPage />} />
        <Route path="/kb/:id" element={<KbArticlePage />} />
        <Route path="/sops" element={<SopListPage />} />
        <Route path="/sops/acknowledgments" element={<MyAcknowledgmentsPage />} />
        <Route path="/sops/:id" element={<SopPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings/*" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
