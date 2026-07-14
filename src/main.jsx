import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './lib/AuthContext';
import { BucketProvider } from './lib/BucketContext';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <BucketProvider>
        <App />
      </BucketProvider>
    </AuthProvider>
  </React.StrictMode>
);
