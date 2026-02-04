# SearchPersons200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[SearchPersons200ResponseItemsInner]**](SearchPersons200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.search_persons200_response import SearchPersons200Response

# TODO update the JSON string below
json = "{}"
# create an instance of SearchPersons200Response from a JSON string
search_persons200_response_instance = SearchPersons200Response.from_json(json)
# print the JSON string representation of the object
print(SearchPersons200Response.to_json())

# convert the object into a dict
search_persons200_response_dict = search_persons200_response_instance.to_dict()
# create an instance of SearchPersons200Response from a dict
search_persons200_response_from_dict = SearchPersons200Response.from_dict(search_persons200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


