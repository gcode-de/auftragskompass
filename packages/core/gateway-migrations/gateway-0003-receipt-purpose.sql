ALTER TABLE ak_gateway_operations DROP CONSTRAINT ak_gateway_operations_check;
ALTER TABLE ak_gateway_operations ADD CONSTRAINT ak_gateway_operations_check
  CHECK ((direction = 'core-to-gateway' AND kind IN ('inquiries.pull', 'inquiries.ack'))
    OR (direction = 'gateway-to-core' AND kind IN ('inquiries.batch', 'inquiries.receipt')));
