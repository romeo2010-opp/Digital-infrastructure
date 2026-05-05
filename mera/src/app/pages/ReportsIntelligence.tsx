import { Download, FileText, TrendingUp } from 'lucide-react';
import { Toolbar } from '../components/Toolbar';

const reports = [
  { name: 'Monthly Hoarding Report', type: 'Enforcement', period: 'April 2024', generated: '2024-05-01', size: '2.3 MB' },
  { name: 'District Fuel Stress Report', type: 'Analytics', period: 'Q1 2024', generated: '2024-04-15', size: '1.8 MB' },
  { name: 'Repeat Offenders Report', type: 'Enforcement', period: 'March 2024', generated: '2024-04-01', size: '890 KB' },
  { name: 'Enforcement Outcome Report', type: 'Compliance', period: 'Q1 2024', generated: '2024-04-10', size: '1.2 MB' },
  { name: 'Complaint Analytics', type: 'Analytics', period: 'April 2024', generated: '2024-05-02', size: '1.5 MB' },
];

const intelligenceActions = [
  { title: 'Generate Hoarding Risk Map', description: 'AI-powered geographical hoarding risk analysis' },
  { title: 'District Stress Forecast', description: 'Predictive analysis for next 7 days' },
  { title: 'Offender Pattern Analysis', description: 'Identify repeat violators and networks' },
  { title: 'Compliance Trend Report', description: 'National compliance trends and insights' },
];

export function ReportsIntelligence() {
  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <Toolbar>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Types</option>
          <option>Enforcement</option>
          <option>Analytics</option>
          <option>Compliance</option>
        </select>
        <select className="bg-slate-900 border border-slate-600 px-2 py-1 rounded text-xs text-slate-300">
          <option>All Periods</option>
          <option>April 2024</option>
          <option>Q1 2024</option>
        </select>
      </Toolbar>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-slate-900 border border-slate-700 rounded">
            <div className="border-b border-slate-700 px-3 py-2">
              <h3 className="text-sm font-medium text-slate-200 uppercase">Downloadable Report Ledger</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-800 text-slate-400 uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Report Name</th>
                    <th className="px-2 py-1.5 text-left">Type</th>
                    <th className="px-2 py-1.5 text-left">Period</th>
                    <th className="px-2 py-1.5 text-left">Generated</th>
                    <th className="px-2 py-1.5 text-left">Size</th>
                    <th className="px-2 py-1.5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {reports.map((report, idx) => (
                    <tr key={idx} className="border-t border-slate-800 hover:bg-slate-800/50">
                      <td className="px-2 py-1.5 font-medium">{report.name}</td>
                      <td className="px-2 py-1.5">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          report.type === 'Enforcement' ? 'bg-red-900/30 border border-red-600 text-red-400' :
                          report.type === 'Analytics' ? 'bg-blue-900/30 border border-blue-600 text-blue-400' :
                          'bg-emerald-900/30 border border-emerald-600 text-emerald-400'
                        }`}>
                          {report.type}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">{report.period}</td>
                      <td className="px-2 py-1.5 text-slate-400">{report.generated}</td>
                      <td className="px-2 py-1.5 text-slate-400">{report.size}</td>
                      <td className="px-2 py-1.5 text-center">
                        <button className="text-cyan-400 hover:text-cyan-300 text-xs underline flex items-center gap-1 mx-auto">
                          <Download className="w-3 h-3" />
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-700 rounded">
            <div className="border-b border-slate-700 px-3 py-2">
              <h3 className="text-sm font-medium text-slate-200 uppercase">Intelligence Generation</h3>
            </div>
            <div className="p-3 space-y-2">
              {intelligenceActions.map((action, idx) => (
                <div key={idx} className="bg-slate-800 border border-slate-700 rounded p-3">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-start gap-2">
                      <TrendingUp className="w-4 h-4 text-cyan-400 mt-0.5" />
                      <div>
                        <h4 className="text-xs font-medium text-slate-200">{action.title}</h4>
                        <p className="text-xs text-slate-400 mt-1">{action.description}</p>
                      </div>
                    </div>
                  </div>
                  <button className="w-full bg-cyan-700 hover:bg-cyan-600 px-3 py-1.5 rounded text-xs flex items-center justify-center gap-1 text-white mt-2">
                    <FileText className="w-3 h-3" />
                    Generate
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
