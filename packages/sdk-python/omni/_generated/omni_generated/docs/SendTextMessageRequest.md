# SendTextMessageRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID to send from | 
**to** | **str** | Recipient (phone number or platform ID) | 
**text** | **str** | Message text | 
**reply_to** | **str** | Message ID to reply to | [optional] 

## Example

```python
from omni_generated.models.send_text_message_request import SendTextMessageRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SendTextMessageRequest from a JSON string
send_text_message_request_instance = SendTextMessageRequest.from_json(json)
# print the JSON string representation of the object
print(SendTextMessageRequest.to_json())

# convert the object into a dict
send_text_message_request_dict = send_text_message_request_instance.to_dict()
# create an instance of SendTextMessageRequest from a dict
send_text_message_request_from_dict = SendTextMessageRequest.from_dict(send_text_message_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


