const L=require('./lib.js');const fs=require('fs');
(async()=>{const files=process.argv.slice(3);const b=await L.launch({phone:false});const p=await b.newPage({viewport:{width:files.length*260,height:600}});
await p.setContent('<body style="margin:0;display:flex;background:#333">'+files.map(f=>`<div style="width:260px;color:#fff;font:12px Arial"><img style="width:256px" src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><br>${f.split('/').pop()}</div>`).join('')+'</body>');
await p.screenshot({path:process.argv[2],fullPage:true});await b.close();})();
