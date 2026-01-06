import { Outlet } from 'react-router-dom';
import Navbar from './components/Navbar';
import './App.css';

export default function App() {
  return (
    <div className="app-layout">
      <Navbar />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
