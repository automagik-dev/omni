# SendTextRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID to send from | 
**to** | **str** | Recipient (phone number or platform ID) | 
**text** | **str** | Message text | 
**reply_to** | **str** | Message ID to reply to | [optional] 

## Example

```python
from omni_generated.models.send_text_request import SendTextRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SendTextRequest from a JSON string
send_text_request_instance = SendTextRequest.from_json(json)
# print the JSON string representation of the object
print(SendTextRequest.to_json())

# convert the object into a dict
send_text_request_dict = send_text_request_instance.to_dict()
# create an instance of SendTextRequest from a dict
send_text_request_from_dict = SendTextRequest.from_dict(send_text_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


