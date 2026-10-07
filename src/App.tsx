import { DemoPage } from './pages/DemoPanel';
import { FamilyApp } from './pages/FamilyApp';
import { Home } from './pages/Home';
import { Present } from './pages/Present';
import { SeniorApp } from './pages/SeniorApp';

// Four screens and plain links: a router library would be more code than the routes.
export function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  switch (path) {
    case '/senior':
      return <SeniorApp />;
    case '/family':
      return <FamilyApp />;
    case '/demo':
      return <DemoPage />;
    case '/present':
      return <Present />;
    default:
      return <Home />;
  }
}
