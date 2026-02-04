# SendMediaMessageRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance ID to send from | 
**to** | **str** | Recipient | 
**type** | **str** | Media type | 
**url** | **str** | Media URL | [optional] 
**var_base64** | **str** | Base64 encoded media | [optional] 
**filename** | **str** | Filename for documents | [optional] 
**caption** | **str** | Caption for media | [optional] 
**voice_note** | **bool** | Send audio as voice note | [optional] 

## Example

```python
from omni_generated.models.send_media_message_request import SendMediaMessageRequest

# TODO update the JSON string below
json = "{}"
# create an instance of SendMediaMessageRequest from a JSON string
send_media_message_request_instance = SendMediaMessageRequest.from_json(json)
# print the JSON string representation of the object
print(SendMediaMessageRequest.to_json())

# convert the object into a dict
send_media_message_request_dict = send_media_message_request_instance.to_dict()
# create an instance of SendMediaMessageRequest from a dict
send_media_message_request_from_dict = SendMediaMessageRequest.from_dict(send_media_message_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


