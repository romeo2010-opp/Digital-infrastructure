import { Plus, Download, Search, MapPin } from 'lucide-react';
import { Toolbar } from '../components/Toolbar';

const inspections = [
  { ref: 'INS-4521', station: 'Shell Westlands', district: 'Nairobi', officer: 'P. Kamau', inspectionType: 'Hoarding Investigation', queueLength: '47 vehicles', pumpsActive: '8/12', illegalVending: 'No', result: 'Violation Found', createdAt: '2024-05-05 10:15' },
  { ref: 'INS-4520', station: 'Hashi Ngong', district: 'Nairobi', officer: 'J. Mwangi', inspectionType: 'Routine Compliance', queueLength: '0 vehicles', pumpsActive: '14/14', illegalVending: 'No', result: 'Compliant', createdAt: '2024-05-05 09:30' },
  { ref: 'INS-4519', station: 'Total Mombasa Rd', district: 'Nairobi', officer: 'M. Otieno', inspectionType: 'Price Check', queueLength: '12 vehicles', pumpsActive: '10/10', illegalVending: 'No', result: 'Price Violation', createdAt: '2024-05-05 08:45' },
  { ref: 'INS-4518', station: 'Rubis Thika', district: 'Kiambu', officer: 'A. Njeri', inspectionType: 'Quality Audit', queueLength: '0 vehicles', pumpsActive: '0/8', illegalVending: 'Yes', result: 'Multiple Violations', createdAt: '2024-05-04 16:20' },
  { ref: 'INS-4517', station: 'Kenol Nakuru', district: 'Nakuru', officer: 'P. Kamau', inspectionType: 'Routine Compliance', queueLength: '5 vehicles', pumpsActive: '12/12', illegalVending: 'No', result: 'Compliant', createdAt: '2024-05-04 14:30' },
];

const evidence = [
  { ref: 'GEO-8821', type: 'Photo', station: 'Shell Westlands', officer: 'P. Kamau', timestamp: '2024-05-05 10:20', location: 'Verified' },
  { ref: 'GEO-8820', type: 'Video', station: 'Rubis Thika', officer: 'A. Njeri', timestamp: '2024-05-04 16:25', location: 'Verified' },
  { ref: 'GEO-8819', type: 'Photo', station: 'Hashi Ngong', officer: 'J. Mwangi', timestamp: '2024-05-05 09:35', location: 'Verified' },
];

export function FieldInspections() {
  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <Toolbar>
        <button className="bg-cyan-700 hover:bg-cyan-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-white">
          <Plus className="w-3 h-3" />
          Schedule Inspection
        </button>
        <button className="bg-blue-700 hover:bg-blue-600 px-3 py-1 rounded text-xs flex items-center gap-1 text-white">
          <Plus className="w-3 h-3" />
          Assign Officer
        </button>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Types</option>
          <option>Hoarding Investigation</option>
          <option>Routine Compliance</option>
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

      <div className="flex-1 overflow-y-auto p-3">
        <div className="bg-slate-900 border border-slate-700 rounded mb-3">
          <div className="border-b border-slate-700 px-3 py-2">
            <h3 className="text-sm font-medium text-slate-200 uppercase">Field Inspection Log</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-slate-400 uppercase">
                <tr>
                  <th className="px-2 py-1.5 text-left">Inspection Ref</th>
                  <th className="px-2 py-1.5 text-left">Station</th>
                  <th className="px-2 py-1.5 text-left">District</th>
                  <th className="px-2 py-1.5 text-left">Officer</th>
                  <th className="px-2 py-1.5 text-left">Inspection Type</th>
                  <th className="px-2 py-1.5 text-left">Queue Length</th>
                  <th className="px-2 py-1.5 text-left">Pumps Active</th>
                  <th className="px-2 py-1.5 text-center">Illegal Vending</th>
                  <th className="px-2 py-1.5 text-left">Result</th>
                  <th className="px-2 py-1.5 text-left">Created At</th>
                  <th className="px-2 py-1.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {inspections.map((inspection) => (
                  <tr key={inspection.ref} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-2 py-1.5 font-mono text-cyan-400">{inspection.ref}</td>
                    <td className="px-2 py-1.5 font-medium">{inspection.station}</td>
                    <td className="px-2 py-1.5">{inspection.district}</td>
                    <td className="px-2 py-1.5 text-slate-400">{inspection.officer}</td>
                    <td className="px-2 py-1.5">{inspection.inspectionType}</td>
                    <td className="px-2 py-1.5">{inspection.queueLength}</td>
                    <td className="px-2 py-1.5 font-mono">{inspection.pumpsActive}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        inspection.illegalVending === 'Yes'
                          ? 'bg-red-900/30 border border-red-600 text-red-400'
                          : 'bg-emerald-900/30 border border-emerald-600 text-emerald-400'
                      }`}>
                        {inspection.illegalVending}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        inspection.result === 'Compliant' ? 'bg-emerald-900/30 border border-emerald-600 text-emerald-400' :
                        inspection.result === 'Violation Found' ? 'bg-orange-900/30 border border-orange-600 text-orange-400' :
                        'bg-red-900/30 border border-red-600 text-red-400'
                      }`}>
                        {inspection.result}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-slate-400">{inspection.createdAt}</td>
                    <td className="px-2 py-1.5 text-center">
                      <button className="text-cyan-400 hover:text-cyan-300 text-xs underline">Details</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-700 rounded">
          <div className="border-b border-slate-700 px-3 py-2">
            <h3 className="text-sm font-medium text-slate-200 uppercase">Uploaded Geotagged Evidence Ledger</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-slate-400 uppercase">
                <tr>
                  <th className="px-2 py-1.5 text-left">Evidence Ref</th>
                  <th className="px-2 py-1.5 text-left">Type</th>
                  <th className="px-2 py-1.5 text-left">Station</th>
                  <th className="px-2 py-1.5 text-left">Officer</th>
                  <th className="px-2 py-1.5 text-left">Timestamp</th>
                  <th className="px-2 py-1.5 text-left">Location Verified</th>
                  <th className="px-2 py-1.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {evidence.map((item) => (
                  <tr key={item.ref} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-2 py-1.5 font-mono text-cyan-400">{item.ref}</td>
                    <td className="px-2 py-1.5">{item.type}</td>
                    <td className="px-2 py-1.5 font-medium">{item.station}</td>
                    <td className="px-2 py-1.5 text-slate-400">{item.officer}</td>
                    <td className="px-2 py-1.5 text-slate-400">{item.timestamp}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">{item.location}</span>
                      </div>
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
