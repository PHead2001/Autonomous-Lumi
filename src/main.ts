import './style.css';

if (new URLSearchParams(location.search).get('view') === 'dashboard') {
  void import('./dashboard').then(({ mountDashboard }) => mountDashboard());
} else {
  void import('./viewer');
}
