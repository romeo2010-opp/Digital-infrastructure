import { Download, Search, AlertTriangle } from 'lucide-react';
import { Toolbar } from '../components/Toolbar';

const licenses = [
  { licenseNo: 'LIC-89234', station: 'Shell Westlands', owner: 'Shell Kenya Ltd', district: 'Nairobi', issueDate: '2022-03-15', expiryDate: '2027-03-15', complianceStatus: 'Warning', renewalAlert: false },
  { licenseNo: 'LIC-89233', station: 'Total Mombasa Rd', owner: 'TotalEnergies Kenya', district: 'Nairobi', issueDate: '2021-06-20', expiryDate: '2026-06-20', complianceStatus: 'Compliant', renewalAlert: false },
  { licenseNo: 'LIC-89232', station: 'Hashi Ngong', owner: 'Hashi Energy Ltd', district: 'Nairobi', issueDate: '2020-09-10', expiryDate: '2025-09-10', complianceStatus: 'Warning', renewalAlert: true },
  { licenseNo: 'LIC-89231', station: 'Rubis Thika', owner: 'Rubis Energy Kenya', district: 'Kiambu', issueDate: '2023-01-05', expiryDate: '2028-01-05', complianceStatus: 'Suspended', renewalAlert: false },
  { licenseNo: 'LIC-89230', station: 'Kenol Nakuru', owner: 'KenolKobil Ltd', district: 'Nakuru', issueDate: '2022-11-18', expiryDate: '2027-11-18', complianceStatus: 'Compliant', renewalAlert: false },
];

export function LicenseRegistry() {
  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <Toolbar>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="w-3 h-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search licenses..."
            className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300 flex-1"
          />
        </div>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Districts</option>
          <option>Nairobi</option>
          <option>Mombasa</option>
        </select>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Statuses</option>
          <option>Compliant</option>
          <option>Warning</option>
          <option>Suspended</option>
        </select>
        <button className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-slate-300">
          <Download className="w-3 h-3" />
          Export
        </button>
      </Toolbar>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="bg-slate-900 border border-slate-700 rounded">
          <div className="border-b border-slate-700 px-3 py-2">
            <h3 className="text-sm font-medium text-slate-200 uppercase">Petroleum Station License Registry</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-slate-400 uppercase">
                <tr>
                  <th className="px-2 py-1.5 text-left">License No</th>
                  <th className="px-2 py-1.5 text-left">Station</th>
                  <th className="px-2 py-1.5 text-left">Owner</th>
                  <th className="px-2 py-1.5 text-left">District</th>
                  <th className="px-2 py-1.5 text-left">Issue Date</th>
                  <th className="px-2 py-1.5 text-left">Expiry Date</th>
                  <th className="px-2 py-1.5 text-left">Compliance Status</th>
                  <th className="px-2 py-1.5 text-center">Renewal Alert</th>
                  <th className="px-2 py-1.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {licenses.map((license) => (
                  <tr key={license.licenseNo} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-2 py-1.5 font-mono text-cyan-400">{license.licenseNo}</td>
                    <td className="px-2 py-1.5 font-medium">{license.station}</td>
                    <td className="px-2 py-1.5">{license.owner}</td>
                    <td className="px-2 py-1.5">{license.district}</td>
                    <td className="px-2 py-1.5 text-slate-400">{license.issueDate}</td>
                    <td className="px-2 py-1.5 text-slate-400">{license.expiryDate}</td>
                    <td className="px-2 py-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        license.complianceStatus === 'Compliant' ? 'bg-emerald-900/30 border border-emerald-600 text-emerald-400' :
                        license.complianceStatus === 'Warning' ? 'bg-amber-900/30 border border-amber-600 text-amber-400' :
                        'bg-red-900/30 border border-red-600 text-red-400'
                      }`}>
                        {license.complianceStatus}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {license.renewalAlert && <AlertTriangle className="w-3 h-3 text-amber-400 inline" />}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button className="text-cyan-400 hover:text-cyan-300 text-xs underline">View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
