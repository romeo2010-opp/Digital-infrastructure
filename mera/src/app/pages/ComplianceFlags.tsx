import { Download, Search, X } from 'lucide-react';
import { Toolbar } from '../components/Toolbar';
import { useState } from 'react';

const flags = [
  { flagId: 'FLG-3421', station: 'Shell Westlands', flagType: 'Delivery-Declaration Mismatch', severity: 'Critical', source: 'Automated System', createdAt: '2024-05-05 08:45', assignedTo: 'P. Kamau', status: 'Under Review' },
  { flagId: 'FLG-3420', station: 'Hashi Ngong', flagType: 'Repeated Complaint Pattern', severity: 'High', source: 'AI Analysis', createdAt: '2024-05-05 07:30', assignedTo: 'J. Mwangi', status: 'Investigation' },
  { flagId: 'FLG-3419', station: 'Total Mombasa Rd', flagType: 'Pump Calibration Overdue', severity: 'Medium', source: 'License Registry', createdAt: '2024-05-04 14:15', assignedTo: 'M. Otieno', status: 'Pending' },
  { flagId: 'FLG-3418', station: 'Rubis Thika', flagType: 'Price Monitoring Alert', severity: 'High', source: 'Field Report', createdAt: '2024-05-04 11:20', assignedTo: 'A. Njeri', status: 'Resolved' },
  { flagId: 'FLG-3417', station: 'Kenol Nakuru', flagType: 'Environmental Violation', severity: 'Medium', source: 'Inspector Report', createdAt: '2024-05-04 09:45', assignedTo: 'P. Kamau', status: 'Under Review' },
];

export function ComplianceFlags() {
  const [selectedFlag, setSelectedFlag] = useState<string | null>(null);

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <Toolbar>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="w-3 h-3 text-slate-400" />
          <input
            type="text"
            placeholder="Search flags..."
            className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300 flex-1"
          />
        </div>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Severities</option>
          <option>Critical</option>
          <option>High</option>
        </select>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Officers</option>
          <option>P. Kamau</option>
          <option>J. Mwangi</option>
        </select>
        <button className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-slate-300">
          <Download className="w-3 h-3" />
          Export
        </button>
      </Toolbar>

      <div className="flex-1 flex overflow-hidden">
        <div className={`${selectedFlag ? 'flex-1' : 'w-full'} overflow-y-auto p-3`}>
          <div className="bg-slate-900 border border-slate-700 rounded">
            <div className="border-b border-slate-700 px-3 py-2">
              <h3 className="text-sm font-medium text-slate-200 uppercase">Compliance Flag Registry</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-800 text-slate-400 uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Flag ID</th>
                    <th className="px-2 py-1.5 text-left">Station</th>
                    <th className="px-2 py-1.5 text-left">Flag Type</th>
                    <th className="px-2 py-1.5 text-left">Severity</th>
                    <th className="px-2 py-1.5 text-left">Generated Source</th>
                    <th className="px-2 py-1.5 text-left">Created At</th>
                    <th className="px-2 py-1.5 text-left">Assigned To</th>
                    <th className="px-2 py-1.5 text-left">Resolution Status</th>
                    <th className="px-2 py-1.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {flags.map((flag) => (
                    <tr key={flag.flagId} className="border-t border-slate-800 hover:bg-slate-800/50">
                      <td className="px-2 py-1.5 font-mono text-cyan-400">{flag.flagId}</td>
                      <td className="px-2 py-1.5 font-medium">{flag.station}</td>
                      <td className="px-2 py-1.5">{flag.flagType}</td>
                      <td className="px-2 py-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          flag.severity === 'Critical' ? 'bg-red-900/30 border border-red-600 text-red-400' :
                          flag.severity === 'High' ? 'bg-orange-900/30 border border-orange-600 text-orange-400' :
                          'bg-amber-900/30 border border-amber-600 text-amber-400'
                        }`}>
                          {flag.severity}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-400">{flag.source}</td>
                      <td className="px-2 py-1.5 text-slate-400">{flag.createdAt}</td>
                      <td className="px-2 py-1.5 text-slate-400">{flag.assignedTo}</td>
                      <td className="px-2 py-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          flag.status === 'Resolved' ? 'bg-emerald-900/30 border border-emerald-600 text-emerald-400' :
                          'bg-blue-900/30 border border-blue-600 text-blue-400'
                        }`}>
                          {flag.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => setSelectedFlag(flag.flagId)}
                          className="text-cyan-400 hover:text-cyan-300 text-xs underline"
                        >
                          Evidence
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {selectedFlag && (
          <div className="w-80 bg-slate-900 border-l border-slate-700 overflow-y-auto p-3">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-slate-200 uppercase">Flag Evidence Chain</h3>
              <button onClick={() => setSelectedFlag(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-slate-800 border border-slate-700 rounded p-2">
                <h4 className="text-xs text-slate-400 uppercase mb-2">Flag Details</h4>
                <p className="text-xs text-slate-300 mb-1"><span className="text-slate-500">Flag ID:</span> <span className="font-mono text-cyan-400">{selectedFlag}</span></p>
                <p className="text-xs text-slate-300 mb-1"><span className="text-slate-500">Station:</span> Shell Westlands</p>
                <p className="text-xs text-slate-300"><span className="text-slate-500">Type:</span> Delivery-Declaration Mismatch</p>
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded p-2">
                <h4 className="text-xs text-slate-400 uppercase mb-2">Evidence Items</h4>
                <div className="space-y-2">
                  <div className="bg-slate-900 p-2 rounded">
                    <p className="text-xs text-emerald-400 mb-1">Delivery Record DLV-5847</p>
                    <p className="text-xs text-slate-400">45,000L Diesel logged at 08:30</p>
                  </div>
                  <div className="bg-slate-900 p-2 rounded">
                    <p className="text-xs text-red-400 mb-1">Declaration AVL-9847</p>
                    <p className="text-xs text-slate-400">Declared "Partial Supply" at 09:15</p>
                  </div>
                  <div className="bg-slate-900 p-2 rounded">
                    <p className="text-xs text-amber-400 mb-1">Complaints: 12 in 24h</p>
                    <p className="text-xs text-slate-400">Citizens report "No fuel available"</p>
                  </div>
                </div>
              </div>

              <div className="bg-red-900/20 border border-red-600 rounded p-2">
                <h4 className="text-xs text-red-400 uppercase mb-2">System Analysis</h4>
                <p className="text-xs text-slate-300">Confidence: 94%</p>
                <p className="text-xs text-slate-300 mt-2">Recent delivery contradicts declared availability status. Complaint pattern suggests hoarding behavior.</p>
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded p-2">
                <h4 className="text-xs text-slate-400 uppercase mb-2">Recommended Action</h4>
                <p className="text-xs text-slate-300">Immediate field inspection with pump check and storage verification.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
