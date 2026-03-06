export default function Privacy() {
    return (
      <div style={{ maxWidth: 800, margin: "40px auto", padding: 20 }}>
        <h1>Privacy Policy</h1>
  
        <p>
          Health OS collects personal health and activity data that users choose
          to provide, including entries logged in the application and optionally
          data connected through third-party integrations such as WHOOP.
        </p>
  
        <h2>Data Usage</h2>
        <p>
          Data is used solely to generate personalized health insights and to
          improve the user experience of the application.
        </p>
  
        <h2>Data Storage</h2>
        <p>
          Data is securely stored using Supabase infrastructure. Images uploaded
          by users are stored in private storage and accessed only through
          authenticated requests.
        </p>
  
        <h2>Third-Party Services</h2>
        <p>
          If users connect external services such as WHOOP, the application may
          retrieve activity, sleep, recovery, and strain data through the WHOOP
          API to provide insights.
        </p>
  
        <h2>Data Sharing</h2>
        <p>
          User data is never sold or shared with third parties except when
          required to operate the service (e.g., AI processing for insights).
        </p>
  
        <h2>User Control</h2>
        <p>
          Users can disconnect integrations and delete their data at any time by
          contacting the application administrator.
        </p>
  
        <h2>Contact</h2>
        <p>
          For privacy questions contact: admin@healthos.app
        </p>
      </div>
    );
  }