# ListSettings200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**key** | **str** | Setting key | 
**value** | **object** | Setting value (masked if secret) | [optional] 
**category** | **str** | Category | 
**is_secret** | **bool** | Whether value is secret | 
**description** | **str** | Description | 
**created_at** | **datetime** | Creation timestamp | 
**updated_at** | **datetime** | Last update timestamp | 

## Example

```python
from omni_generated.models.list_settings200_response_items_inner import ListSettings200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListSettings200ResponseItemsInner from a JSON string
list_settings200_response_items_inner_instance = ListSettings200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListSettings200ResponseItemsInner.to_json())

# convert the object into a dict
list_settings200_response_items_inner_dict = list_settings200_response_items_inner_instance.to_dict()
# create an instance of ListSettings200ResponseItemsInner from a dict
list_settings200_response_items_inner_from_dict = ListSettings200ResponseItemsInner.from_dict(list_settings200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


