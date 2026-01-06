import { NavLink } from 'react-router-dom';

const examples = [
  { path: '/', label: 'Biconomy MEE' },
  { path: '/para', label: 'Para Wallet' },
  { path: '/privy', label: 'Privy' },
  { path: '/dynamic', label: 'Dynamic' },
];

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <div className="brand-icon">W</div>
        <span className="brand-name">Wallet Examples</span>
      </div>
      
      <div className="navbar-links">
        {examples.map(({ path, label }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) => 
              `nav-link ${isActive ? 'nav-link-active' : ''}`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

