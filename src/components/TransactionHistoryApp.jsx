import React from 'react';
import { WalletProvider } from './WalletContext';
import { ToastProvider } from './Toast';
import TransactionHistoryPage from './TransactionHistoryPage';

const TransactionHistoryApp = () => (
  <WalletProvider>
    <ToastProvider>
      <div className="container">
        <TransactionHistoryPage />
      </div>
    </ToastProvider>
  </WalletProvider>
);

export default TransactionHistoryApp;