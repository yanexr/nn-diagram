<Diagram width={560} height={232} grid={4} title="Request flow">
  <Box id="client" x={24} y={68} w={96} h={40} variant="muted" tip="Sends a request, for example from a browser.">Client</Box>
  <Box id="api" x={176} y={24} w={216} h={184} variant="panel-blue">
    API service
    <Box id="auth" x={24} y={48} w={168} h={32} tip="Checks the **access token** before anything else runs.">Auth</Box>
    <Box id="handler" x={24} y={120} w={168} h={32} variant="blue" tip="Validates the input and reads or writes the data.">Handler</Box>
    <Arrow from="auth" to="handler" />
  </Box>
  <Box id="db" x={448} y={136} w={88} h={48} shape="cylinder" variant="orange" tip="Stores the data.">Database</Box>
  <Arrow from="client" to="auth@left" />
  <Arrow from="handler" to="db" tail="arrow" />
  <Steps>
    <Step title="Request" focus="client auth">{`The client calls the API. Every request is checked first.`}</Step>
    <Step title="Handling" focus="handler db">{`The handler does the work and talks to the database.`}</Step>
  </Steps>
</Diagram>
