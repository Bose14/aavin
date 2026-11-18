import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';

import SuperAdminDashboard from './pages/superadmin/SuperAdminDashboard';

import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUnits from './pages/admin/AdminUnits';
import AdminTeams from './pages/admin/AdminTeams';
import AdminUsers from './pages/admin/AdminUsers';
import AdminMilkRecords from './pages/admin/AdminMilkRecords';
import AdminTankerRecords from './pages/admin/AdminTankerRecords';
import AdminSettings from './pages/admin/AdminSettings';

import UnitDashboard from './pages/unit/UnitDashboard';
import MilkEntry from './pages/unit/MilkEntry';
import TankerDispatch from './pages/unit/TankerDispatch';
import UnitRecords from './pages/unit/UnitRecords';

import GateOperations from './pages/plant/GateOperations';
import QCLab from './pages/plant/QCLab';
import UnloadingBay from './pages/plant/UnloadingBay';
import PlantRecords from './pages/plant/PlantRecords';

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/change-password"
              element={
                <ProtectedRoute allowPasswordChange>
                  <ChangePassword />
                </ProtectedRoute>
              }
            />

            {/* Super Admin portal */}
            <Route path="/superadmin" element={<ProtectedRoute role="superadmin"><Layout><SuperAdminDashboard /></Layout></ProtectedRoute>} />

            {/* Admin portal */}
            <Route path="/admin" element={<Navigate to="/admin/tanker" replace />} />
            <Route path="/admin/tanker" element={<ProtectedRoute role="admin"><Layout><AdminTankerRecords /></Layout></ProtectedRoute>} />
            <Route path="/admin/units" element={<ProtectedRoute role="admin"><Layout><AdminUnits /></Layout></ProtectedRoute>} />
            <Route path="/admin/teams" element={<ProtectedRoute role="admin"><Layout><AdminTeams /></Layout></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute role="admin"><Layout><AdminUsers /></Layout></ProtectedRoute>} />
            <Route path="/admin/analytics" element={<ProtectedRoute role="admin"><Layout><AdminDashboard /></Layout></ProtectedRoute>} />
            <Route path="/admin/milk" element={<ProtectedRoute role="admin"><Layout><AdminMilkRecords /></Layout></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute role="admin"><Layout><AdminSettings /></Layout></ProtectedRoute>} />

            {/* Unit portal */}
            <Route path="/unit" element={<ProtectedRoute role="unit"><Layout><UnitDashboard /></Layout></ProtectedRoute>} />
            <Route path="/unit/milk-entry" element={<ProtectedRoute role="unit"><Layout><MilkEntry /></Layout></ProtectedRoute>} />
            <Route path="/unit/tanker" element={<ProtectedRoute role="unit"><Layout><TankerDispatch /></Layout></ProtectedRoute>} />
            <Route path="/unit/records" element={<ProtectedRoute role="unit"><Layout><UnitRecords /></Layout></ProtectedRoute>} />

            {/* Plant Team Portals */}
            <Route path="/gate" element={<ProtectedRoute role={['gate', 'admin', 'superadmin']}><Layout><GateOperations /></Layout></ProtectedRoute>} />
            <Route path="/gate/records" element={<ProtectedRoute role={['gate', 'admin', 'superadmin']}><Layout><PlantRecords /></Layout></ProtectedRoute>} />
            <Route path="/qc" element={<ProtectedRoute role={['qc', 'admin', 'superadmin']}><Layout><QCLab /></Layout></ProtectedRoute>} />
            <Route path="/qc/records" element={<ProtectedRoute role={['qc', 'admin', 'superadmin']}><Layout><PlantRecords /></Layout></ProtectedRoute>} />
            <Route path="/unloading" element={<ProtectedRoute role={['unloading', 'admin', 'superadmin']}><Layout><UnloadingBay /></Layout></ProtectedRoute>} />
            <Route path="/unloading/records" element={<ProtectedRoute role={['unloading', 'admin', 'superadmin']}><Layout><PlantRecords /></Layout></ProtectedRoute>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  );
}
