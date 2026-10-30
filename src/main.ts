import './style.css';
import { mountViewerShell } from './viewer-shell';

if (new URLSearchParams(location.search).get('view') === 'dashboard') {
  void import('./dashboard').then(({ mountDashboard }) => mountDashboard());
} else {
  mountViewerShell();
  void import('./viewer');
}
