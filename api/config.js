// Public, non-secret config for the page. The web chat widget id is public by design (it is embedded in any site using the widget).
import { vendastaConfigured } from '../lib/vendasta.js';
export default function handler(req,res){
  res.setHeader('cache-control','no-store');
  res.status(200).json({widgetId:process.env.VENDASTA_WEBCHAT_WIDGET_ID||null,vendasta:vendastaConfigured()&&process.env.VENDASTA_WRITE_ENABLED==='true'});
}
