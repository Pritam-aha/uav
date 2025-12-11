import React from 'react';

const Header = ({ masterUAVId }) => {
  return (
    <header className="header">
      <div>
        <h1>🚁 UAV Rescue Dashboard</h1>
        <div className="subtitle">
          Real-time rescue coordination with ISAC adaptive communication
        </div>
        {masterUAVId && (
          <div style={{
            marginTop: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
            color: '#78350f',
            fontWeight: '600'
          }}>
            <span>👑</span>
            <span>Master Drone: <span style={{ color: '#fbbf24' }}>{masterUAVId}</span></span>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;