import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { supabase } from './supabase';
import { AuthProvider } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';

import AdminDashboard from './pages/admin/AdminDashboard';
import AdminBmcs from './pages/admin/AdminBmcs';
import AdminTeams from './pages/admin/AdminTeams';
import AdminUsers from './pages/admin/AdminUsers';
import AdminMilkRecords from './pages/admin/AdminMilkRecords';
import AdminTankerRecords from './pages/admin/AdminTankerRecords';
import AdminReports from './pages/admin/AdminReports';
import AdminTankers from './pages/admin/AdminTankers';
import AdminRateChart from './pages/admin/AdminRateChart';
import AdminSettings from './pages/admin/AdminSettings';

import AdminBmcReport from './pages/admin/AdminBmcReport';
import UnitDashboard from './pages/unit/UnitDashboard';
import MilkEntry from './pages/unit/MilkEntry';
import TankerDispatch from './pages/unit/TankerDispatch';
import UnitRecords from './pages/unit/UnitRecords';

import GateOperations from './pages/plant/GateOperations';
import QCLab from './pages/plant/QCLab';
import UnloadingBay from './pages/plant/UnloadingBay';
import PlantRecords from './pages/plant/PlantRecords';

/** Never let one user's cached data survive into the next session. */
function ClearCacheOnSignOut() {
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') queryClient.clear();
    });
    return () => subscription.unsubscribe();
  }, []);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <ClearCacheOnSignOut />
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

            {/* Admin portal */}
            <Route path="/admin" element={<Navigate to="/admin/tanker" replace />} />
            <Route path="/admin/tanker" element={<ProtectedRoute role="admin"><Layout><AdminTankerRecords /></Layout></ProtectedRoute>} />
            <Route path="/admin/reports" element={<ProtectedRoute role="admin"><Layout><AdminReports /></Layout></ProtectedRoute>} />
            <Route path="/admin/tankers" element={<ProtectedRoute role="admin"><Layout><AdminTankers /></Layout></ProtectedRoute>} />
            <Route path="/admin/rates" element={<ProtectedRoute role="admin"><Layout><AdminRateChart /></Layout></ProtectedRoute>} />
            <Route path="/admin/bmc-report" element={<ProtectedRoute role="admin"><Layout><AdminBmcReport /></Layout></ProtectedRoute>} />
            <Route path="/admin/bmcs" element={<ProtectedRoute role="admin"><Layout><AdminBmcs /></Layout></ProtectedRoute>} />
            <Route path="/admin/teams" element={<ProtectedRoute role="admin"><Layout><AdminTeams /></Layout></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute role="admin"><Layout><AdminUsers /></Layout></ProtectedRoute>} />
            <Route path="/admin/analytics" element={<ProtectedRoute role="admin"><Layout><AdminDashboard /></Layout></ProtectedRoute>} />
            <Route path="/admin/milk" element={<ProtectedRoute role="admin"><Layout><AdminMilkRecords /></Layout></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute role="admin"><Layout><AdminSettings /></Layout></ProtectedRoute>} />

            {/* BMC portal */}
            <Route path="/bmc" element={<Navigate to="/bmc/tanker" replace />} />
            <Route path="/bmc/tanker" element={<ProtectedRoute role="bmc"><Layout><TankerDispatch /></Layout></ProtectedRoute>} />
            <Route path="/bmc/analytics" element={<ProtectedRoute role="bmc"><Layout><UnitDashboard /></Layout></ProtectedRoute>} />
            <Route path="/bmc/milk-entry" element={<ProtectedRoute role="bmc"><Layout><MilkEntry /></Layout></ProtectedRoute>} />
            <Route path="/bmc/records" element={<ProtectedRoute role="bmc"><Layout><UnitRecords /></Layout></ProtectedRoute>} />

            {/* Plant Team Portals */}
            <Route path="/gate" element={<ProtectedRoute role={['gate', 'admin']}><Layout><GateOperations activeView="receipt" /></Layout></ProtectedRoute>} />
            <Route path="/gate/gross-weight" element={<ProtectedRoute role={['gate', 'admin']}><Layout><GateOperations activeView="gross" /></Layout></ProtectedRoute>} />
            <Route path="/gate/tare-weight" element={<ProtectedRoute role={['gate', 'admin']}><Layout><GateOperations activeView="tare" /></Layout></ProtectedRoute>} />
            <Route path="/gate/tanker-out" element={<ProtectedRoute role={['gate', 'admin']}><Layout><GateOperations activeView="exit" /></Layout></ProtectedRoute>} />
            <Route path="/gate/records" element={<ProtectedRoute role={['gate', 'admin']}><Layout><PlantRecords /></Layout></ProtectedRoute>} />
            <Route path="/qc" element={<ProtectedRoute role={['qc', 'admin']}><Layout><QCLab activeView="qc" /></Layout></ProtectedRoute>} />
            <Route path="/qc/cip" element={<ProtectedRoute role={['qc', 'admin']}><Layout><QCLab activeView="cip" /></Layout></ProtectedRoute>} />
            <Route path="/qc/gate-pass" element={<ProtectedRoute role={['qc', 'admin']}><Layout><QCLab activeView="gate-pass" /></Layout></ProtectedRoute>} />
            <Route path="/qc/records" element={<ProtectedRoute role={['qc', 'admin']}><Layout><PlantRecords /></Layout></ProtectedRoute>} />
            <Route path="/unloading" element={<ProtectedRoute role={['unloading', 'admin']}><Layout><UnloadingBay /></Layout></ProtectedRoute>} />
            <Route path="/unloading/records" element={<ProtectedRoute role={['unloading', 'admin']}><Layout><PlantRecords /></Layout></ProtectedRoute>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
    </QueryClientProvider>
  );
}
