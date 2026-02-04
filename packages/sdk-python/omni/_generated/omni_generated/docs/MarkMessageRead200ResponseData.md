# MarkMessageRead200ResponseData


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
from omni_generated.models.mark_message_read200_response_data import MarkMessageRead200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of MarkMessageRead200ResponseData from a JSON string
mark_message_read200_response_data_instance = MarkMessageRead200ResponseData.from_json(json)
# print the JSON string representation of the object
print(MarkMessageRead200ResponseData.to_json())

# convert the object into a dict
mark_message_read200_response_data_dict = mark_message_read200_response_data_instance.to_dict()
# create an instance of MarkMessageRead200ResponseData from a dict
mark_message_read200_response_data_from_dict = MarkMessageRead200ResponseData.from_dict(mark_message_read200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


