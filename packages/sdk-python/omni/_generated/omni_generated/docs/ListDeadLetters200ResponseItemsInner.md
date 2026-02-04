# ListDeadLetters200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Dead letter UUID | 
**event_id** | **UUID** | Original event UUID | 
**event_type** | **str** | Event type | 
**status** | **str** | Status | 
**error_message** | **str** | Error message | 
**error_stack** | **str** | Error stack trace | 
**retry_count** | **int** | Retry attempts | 
**last_retry_at** | **datetime** | Last retry timestamp | 
**resolved_at** | **datetime** | Resolution timestamp | 
**resolution_note** | **str** | Resolution note | 
**created_at** | **datetime** | Creation timestamp | 

## Example

```python
from omni_generated.models.list_dead_letters200_response_items_inner import ListDeadLetters200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListDeadLetters200ResponseItemsInner from a JSON string
list_dead_letters200_response_items_inner_instance = ListDeadLetters200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListDeadLetters200ResponseItemsInner.to_json())

# convert the object into a dict
list_dead_letters200_response_items_inner_dict = list_dead_letters200_response_items_inner_instance.to_dict()
# create an instance of ListDeadLetters200ResponseItemsInner from a dict
list_dead_letters200_response_items_inner_from_dict = ListDeadLetters200ResponseItemsInner.from_dict(list_dead_letters200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


