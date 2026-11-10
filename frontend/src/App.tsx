import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/Login';

import SuperAdminDashboard from './pages/superadmin/SuperAdminDashboard';

import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUnits from './pages/admin/AdminUnits';
import AdminUsers from './pages/admin/AdminUsers';
import AdminMilkRecords from './pages/admin/AdminMilkRecords';
import AdminTankerRecords from './pages/admin/AdminTankerRecords';

import UnitDashboard from './pages/unit/UnitDashboard';
import MilkEntry from './pages/unit/MilkEntry';
import TankerDispatch from './pages/unit/TankerDispatch';
import UnitRecords from './pages/unit/UnitRecords';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />

          {/* Super Admin portal */}
          <Route path="/superadmin" element={<ProtectedRoute role="superadmin"><Layout><SuperAdminDashboard /></Layout></ProtectedRoute>} />

          {/* Admin portal */}
          <Route path="/admin" element={<ProtectedRoute role="admin"><Layout><AdminDashboard /></Layout></ProtectedRoute>} />
          <Route path="/admin/units" element={<ProtectedRoute role="admin"><Layout><AdminUnits /></Layout></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute role="admin"><Layout><AdminUsers /></Layout></ProtectedRoute>} />
          <Route path="/admin/milk" element={<ProtectedRoute role="admin"><Layout><AdminMilkRecords /></Layout></ProtectedRoute>} />
          <Route path="/admin/tanker" element={<ProtectedRoute role="admin"><Layout><AdminTankerRecords /></Layout></ProtectedRoute>} />

          {/* Unit portal */}
          <Route path="/unit" element={<ProtectedRoute role="unit"><Layout><UnitDashboard /></Layout></ProtectedRoute>} />
          <Route path="/unit/milk-entry" element={<ProtectedRoute role="unit"><Layout><MilkEntry /></Layout></ProtectedRoute>} />
          <Route path="/unit/tanker" element={<ProtectedRoute role="unit"><Layout><TankerDispatch /></Layout></ProtectedRoute>} />
          <Route path="/unit/records" element={<ProtectedRoute role="unit"><Layout><UnitRecords /></Layout></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
