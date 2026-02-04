# SendTextMessage201ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**message_id** | **str** | Internal message ID | 
**external_message_id** | **str** | External platform message ID | 
**status** | **str** | Message status | 
**instance_id** | **UUID** | Instance UUID | [optional] 
**to** | **str** | Recipient | [optional] 
**media_type** | **str** | Media type if applicable | [optional] 

## Example

```python
from omni_generated.models.send_text_message201_response_data import SendTextMessage201ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of SendTextMessage201ResponseData from a JSON string
send_text_message201_response_data_instance = SendTextMessage201ResponseData.from_json(json)
# print the JSON string representation of the object
print(SendTextMessage201ResponseData.to_json())

# convert the object into a dict
send_text_message201_response_data_dict = send_text_message201_response_data_instance.to_dict()
# create an instance of SendTextMessage201ResponseData from a dict
send_text_message201_response_data_from_dict = SendTextMessage201ResponseData.from_dict(send_text_message201_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


