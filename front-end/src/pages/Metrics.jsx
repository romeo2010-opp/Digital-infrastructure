import { SmartLinkLogo, Growth, DownGrowth, Folder } from "../icons"
function Metrics({ label, data, growth }){

    return (
    <div className="metrics">
        <Folder/>
        <div>
            <p>{label}</p>
            <h1>{data}</h1>  
         </div>
         <div className="growth">
            { growth === "Up" ? <Growth /> : <DownGrowth/>}
        </div>
     </div>
    )
}

export default Metrics