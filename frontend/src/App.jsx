import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import StoreView from './StoreView';
import AdminDashboard from './AdminDashboard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Ruta para clientes / público general */}
        <Route path="/" element={<StoreView />} />

        {/* Ruta privada para gestión de inventario y finanzas */}
        <Route path="/admin" element={<AdminDashboard />} />

        {/* Redirección ante cualquier ruta inexistente */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}