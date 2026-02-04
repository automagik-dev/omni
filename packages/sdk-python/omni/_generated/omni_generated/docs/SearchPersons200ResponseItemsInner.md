# SearchPersons200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Person UUID | 
**display_name** | **str** | Display name | 
**email** | **str** | Email address | 
**phone** | **str** | Phone number | 
**created_at** | **datetime** | Creation timestamp | 
**updated_at** | **datetime** | Last update timestamp | 

## Example

```python
from omni_generated.models.search_persons200_response_items_inner import SearchPersons200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of SearchPersons200ResponseItemsInner from a JSON string
search_persons200_response_items_inner_instance = SearchPersons200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(SearchPersons200ResponseItemsInner.to_json())

# convert the object into a dict
search_persons200_response_items_inner_dict = search_persons200_response_items_inner_instance.to_dict()
# create an instance of SearchPersons200ResponseItemsInner from a dict
search_persons200_response_items_inner_from_dict = SearchPersons200ResponseItemsInner.from_dict(search_persons200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


