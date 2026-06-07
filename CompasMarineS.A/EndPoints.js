const API_BASE_URL = process.env.APP_API_BASE_URL || 'https://compasmarine-production.up.railway.app/';

const endpoints = [
  '/controldoc/document-types',
  '/controldoc/entities',
  '/controldoc/documents'
];

async function probarEndpoints() {
  for (const endpoint of endpoints) {
    const url = `${API_BASE_URL}${endpoint}?page=1&per_page=2`;
    console.log('\n=================================================');
    console.log(`Consultando proxy: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow'
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error(`Error HTTP: ${response.status} ${response.statusText}`);
        console.log('Detalle:', errorData);
        console.log('=================================================\n');
        continue;
      }

      const data = await response.json();
      console.log('Exito');
      console.log(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error de conexion:', error);
    }

    console.log('=================================================\n');
  }
}

probarEndpoints();
