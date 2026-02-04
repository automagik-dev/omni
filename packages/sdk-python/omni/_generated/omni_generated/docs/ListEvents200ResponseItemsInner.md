# ListEvents200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Event UUID | 
**event_type** | **str** | Event type | 
**content_type** | **str** | Content type | 
**instance_id** | **UUID** | Instance UUID | 
**person_id** | **UUID** | Person UUID | 
**direction** | **str** | Message direction | 
**text_content** | **str** | Text content | 
**transcription** | **str** | Audio transcription | 
**image_description** | **str** | Image description | 
**received_at** | **datetime** | When event was received | 
**processed_at** | **datetime** | When event was processed | 

## Example

```python
from omni_generated.models.list_events200_response_items_inner import ListEvents200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListEvents200ResponseItemsInner from a JSON string
list_events200_response_items_inner_instance = ListEvents200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListEvents200ResponseItemsInner.to_json())

# convert the object into a dict
list_events200_response_items_inner_dict = list_events200_response_items_inner_instance.to_dict()
# create an instance of ListEvents200ResponseItemsInner from a dict
list_events200_response_items_inner_from_dict = ListEvents200ResponseItemsInner.from_dict(list_events200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


