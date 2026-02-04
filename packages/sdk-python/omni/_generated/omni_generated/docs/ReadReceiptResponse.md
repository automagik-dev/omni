# ReadReceiptResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**message_id** | **str** | Internal message ID (if single message) | [optional] 
**external_message_id** | **str** | External message ID | [optional] 
**chat_id** | **str** | Chat ID | [optional] 
**instance_id** | **UUID** | Instance ID | [optional] 
**message_count** | **float** | Number of messages marked (batch only) | [optional] 

## Example

```python
from omni_generated.models.read_receipt_response import ReadReceiptResponse

# TODO update the JSON string below
json = "{}"
# create an instance of ReadReceiptResponse from a JSON string
read_receipt_response_instance = ReadReceiptResponse.from_json(json)
# print the JSON string representation of the object
print(ReadReceiptResponse.to_json())

# convert the object into a dict
read_receipt_response_dict = read_receipt_response_instance.to_dict()
# create an instance of ReadReceiptResponse from a dict
read_receipt_response_from_dict = ReadReceiptResponse.from_dict(read_receipt_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


